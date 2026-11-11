"""
whisper_server/server.py — High-Performance Voice Recognition Server for Tenali

Uses fine-tuned OpenAI Whisper-Tiny (gradient-queen/whisper-tiny-indian-digits-final)
to recognize spoken Indian English and regional language digits (1-10) with sub-100ms latency.

Features:
- Dynamic model resolution (Hugging Face Hub, local snapshot cache, or environment path)
- Hardware acceleration (Auto-detects CUDA GPU / Apple Silicon MPS / CPU)
- 16kHz mono audio normalization and padding
- Comprehensive phonetic resolver for Indian accents and regional number words
- Built-in interactive browser test console at http://127.0.0.1:8000
- Full CORS support for Tenali frontend (Vercel, local Vite dev server, tenali.fun)
"""

import os
import sys
import io
import re
import time
import glob
import mimetypes
from typing import Optional

# Prevent Keras/TensorFlow version conflicts with Hugging Face Transformers
os.environ["USE_TF"] = "0"
os.environ["TRANSFORMERS_NO_TF"] = "1"

import uvicorn
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, UploadFile, File, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse

app = FastAPI(
    title="Tenali Whisper Voice Recognition Service",
    description="Fine-tuned Whisper-Tiny neural speech recognition for Indian digits 1 to 10",
    version="2.0.0"
)

# Enable CORS for all frontends (localhost, Vercel, tenali.fun)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model state
_processor = None
_model = None
_device = "cuda" if torch.cuda.is_available() else ("mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu")
_torch_dtype = torch.float16 if _device == "cuda" else torch.float32

# Multi-lingual & phonetic digit mapping for Indian children
DIGIT_PATTERNS = {
    1: re.compile(r"\b(1|one|won|wan|wun|van|when|run|first|ek|ondru|onnu|onru|okati|un|uno)\b|एक|ஒன்று|ஒன்னு|ఒకటి", re.I),
    2: re.compile(r"\b(2|two|to|too|tu|do|doo|second|erandu|irandu|rendu|dos)\b|दो|இரண்டு|ரெண்டு|రెండు", re.I),
    3: re.compile(r"\b(3|three|tree|free|thee|tri|tea|third|teen|tin|moonu|moondru|moodu|tres)\b|तीन|மூன்று|மூணு|మూడు", re.I),
    4: re.compile(r"\b(4|four|for|fore|far|fo|ford|fourth|char|chaar|naalu|naangu|cuatro)\b|चार|நான்கு|நாலு|నాలుగు", re.I),
    5: re.compile(r"\b(5|five|faiv|fai|fiv|fifth|panch|paanch|anju|aindhu|ainthu|aidu|cinco|bye|buy)\b|पाँच|ஐந்து|அஞ்சு|ఐదు", re.I),
    6: re.compile(r"\b(6|six|siks|sick|sicks|sixth|chhe|che|chha|aaru|seis)\b|छह|ஆறு|ఆరు", re.I),
    7: re.compile(r"\b(7|seven|sevn|sevan|sevin|seventh|saat|sat|yezhu|ezhu|yedu|siete)\b|सात|ஏழு|ఏడు", re.I),
    8: re.compile(r"\b(8|eight|ate|ait|eat|eighth|aath|ath|ettu|enimidi|ocho)\b|आठ|எட்டு|ఎనిమిది", re.I),
    9: re.compile(r"\b(9|nine|nain|nin|night|ninth|nau|no|ombodhu|onpathu|onbathu|thommidi|nueve)\b|नौ|ஒன்பது|తొమ్మిది", re.I),
    10: re.compile(r"\b(10|ten|tan|tin|den|then|tenth|das|dus|pathu|patthu|padi|diez)\b|दस|பத்து|పది", re.I),
}

WORD_NAMES = {
    1: "ONE", 2: "TWO", 3: "THREE", 4: "FOUR", 5: "FIVE",
    6: "SIX", 7: "SEVEN", 8: "EIGHT", 9: "NINE", 10: "TEN"
}

def resolve_digit(text: str) -> Optional[int]:
    """Matches raw speech transcriptions to an exact integer digit (1-10)."""
    if not text:
        return None
    clean = re.sub(r"[^a-zA-Z0-9\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\s]", " ", text.lower()).strip()
    digit_match = re.search(r"\b([1-9]|10)\b", clean)
    if digit_match:
        return int(digit_match.group(1))
    for num, pat in DIGIT_PATTERNS.items():
        if pat.search(clean):
            return num
    return None

def find_model_path() -> str:
    """Dynamically resolves the model location without requiring hardcoded paths."""
    # 1. Environment variable override
    env_path = os.getenv("WHISPER_MODEL_PATH") or os.getenv("MODEL_PATH")
    if env_path and os.path.exists(env_path):
        return env_path

    # 2. Local repo models folder
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    local_weights = os.path.join(root_dir, "client", "public", "models", "whisper_indian_digits")
    if os.path.exists(os.path.join(local_weights, "config.json")):
        return local_weights

    # 3. Dynamic search in user's Hugging Face cache
    cache_pattern = os.path.expanduser("~/.cache/huggingface/hub/models--gradient-queen--whisper-tiny-indian-digits-final/snapshots/*")
    snapshots = glob.glob(cache_pattern)
    if snapshots and os.path.isdir(snapshots[0]):
        return snapshots[0]

    # 4. Hugging Face Hub checkpoint ID
    return "gradient-queen/whisper-tiny-indian-digits-final"

def get_model():
    """Lazy loader for processor and model with persistent memory retention."""
    global _processor, _model
    if _processor is None or _model is None:
        from transformers import WhisperProcessor, WhisperForConditionalGeneration

        model_path = find_model_path()
        print(f"[whisper_server] Loading fine-tuned Whisper model from: {model_path}")
        print(f"[whisper_server] Target compute device: {_device} ({_torch_dtype})")

        _processor = WhisperProcessor.from_pretrained(model_path)
        _model = WhisperForConditionalGeneration.from_pretrained(
            model_path,
            torch_dtype=_torch_dtype
        ).to(_device)
        _model.eval()
        print("[whisper_server] Model loaded into memory successfully!")
    return _processor, _model

@app.on_event("startup")
def startup_event():
    """Pre-warm model weights into memory at startup."""
    print("=" * 68)
    print(" TENALI WHISPER VOICE RECOGNITION SERVER")
    print(f" Compute Device: {_device.upper()} | Dtype: {_torch_dtype}")
    print("=" * 68)
    try:
        get_model()
        print("[whisper_server] Model is pre-warmed and ready for sub-100ms requests.")
    except Exception as e:
        print(f"[whisper_server] Notice: Model pre-warming deferred: {e}")

@app.get("/api/health")
def health():
    """Health check endpoint for reverse-proxy monitoring and client autodetection."""
    is_loaded = _model is not None and _processor is not None
    return {
        "status": "ok",
        "service": "tenali-whisper-voice",
        "model_loaded": is_loaded,
        "model_name": "gradient-queen/whisper-tiny-indian-digits-final",
        "device": _device,
        "dtype": str(_torch_dtype)
    }

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)

@app.post("/api/recognize")
async def recognize(request: Request, file: Optional[UploadFile] = File(None)):
    """
    Primary endpoint for NumberTracingApp and SpaceMazeAdventure.
    Accepts multipart/form-data or binary audio body.
    Returns structured JSON with recognized digit and latency diagnostics.
    """
    start_time = time.perf_counter()
    try:
        # Read raw audio bytes from multipart form or request body
        if file is not None:
            content = await file.read()
            filename = file.filename or "upload.wav"
        else:
            content = await request.body()
            filename = "raw_body.wav"

        if not content or len(content) < 100:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Empty or corrupted audio payload."}
            )

        # Decode audio into 16kHz mono Float32 numpy array
        try:
            audio_data, sample_rate = sf.read(io.BytesIO(content))
        except Exception:
            # Fallback for raw PCM 16-bit 16kHz
            audio_data = np.frombuffer(content, dtype=np.int16).astype(np.float32) / 32768.0
            sample_rate = 16000

        # Convert stereo/multi-channel to mono
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)

        # Resample to 16000 Hz if necessary
        if sample_rate != 16000:
            import scipy.signal
            num_samples = int(len(audio_data) * 16000 / sample_rate)
            audio_data = scipy.signal.resample(audio_data, num_samples)

        # Pad very short utterances with gentle silence so Whisper receives sufficient frames
        if len(audio_data) < 8000:
            pad = np.zeros(8000 - len(audio_data), dtype=np.float32)
            audio_data = np.concatenate([audio_data, pad])

        processor, model = get_model()

        # Neural transcription
        with torch.no_grad():
            input_features = processor(
                audio_data,
                sampling_rate=16000,
                return_tensors="pt"
            ).input_features.to(_device, dtype=_torch_dtype)

            predicted_ids = model.generate(
                input_features,
                language="en",
                task="transcribe",
                max_new_tokens=15,
                num_beams=1,
                do_sample=False
            )
            raw_text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()

        # Resolve digit (1-10) using multi-lingual phonetic normalizer
        resolved_num = resolve_digit(raw_text)
        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 1)

        display_text = f"{WORD_NAMES[resolved_num]} ({resolved_num})" if resolved_num else (raw_text or "")

        print(f"[whisper_server] Audio: {len(content)}B | Raw: '{raw_text}' -> Digit: {resolved_num} ({elapsed_ms}ms)")

        return {
            "status": "success",
            "digit": resolved_num,
            "text": display_text,
            "raw": raw_text,
            "latency_ms": elapsed_ms,
            "device": _device
        }

    except Exception as e:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 1)
        print(f"[whisper_server] Error during recognition: {e}")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": str(e), "latency_ms": elapsed_ms}
        )

@app.post("/api/transcribe")
async def transcribe(request: Request, file: Optional[UploadFile] = File(None)):
    """General speech-to-text endpoint returning raw transcript text."""
    res = await recognize(request, file)
    if isinstance(res, JSONResponse):
        return res
    return {"text": res.get("raw", ""), "status": res.get("status")}

# Built-in interactive browser test console
@app.get("/", response_class=HTMLResponse)
def index():
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tenali Whisper Voice Recognition Service</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #f97316;
      --success: #10b981;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 32px 16px;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 680px;
      width: 100%;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.4);
    }
    h1 {
      margin-top: 0;
      font-size: 1.75rem;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.2);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .mic-button {
      width: 100%;
      padding: 18px;
      border-radius: 14px;
      border: none;
      background: var(--accent);
      color: white;
      font-size: 1.15rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: all 0.2s ease;
      margin-top: 24px;
    }
    .mic-button:hover { background: #ea580c; }
    .mic-button.recording {
      background: #ef4444;
      animation: pulse 1.2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.9; transform: scale(0.98); }
    }
    .output-box {
      margin-top: 24px;
      padding: 20px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--border);
      min-height: 120px;
    }
    .digit-hero {
      font-size: 3rem;
      font-weight: 800;
      color: #6ee7b7;
      text-align: center;
      margin: 10px 0;
    }
    .meta-table {
      width: 100%;
      margin-top: 20px;
      font-size: 0.85rem;
      border-collapse: collapse;
    }
    .meta-table td { padding: 6px 0; }
    .meta-table td:first-child { color: var(--text-muted); width: 40%; }
    .meta-table td:last-child { font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h1>🎙️ Tenali Whisper Server</h1>
      <span class="badge" id="statusBadge">Checking...</span>
    </div>
    <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">
      Fine-Tuned Indian Digits Speech Recognition API (<a href="/docs" target="_blank" style="color: var(--accent);">Swagger Docs</a>)
    </p>

    <button id="recordBtn" class="mic-button">
      <span>🎙️ Click to Speak (Say 1 to 10)</span>
    </button>

    <div class="output-box">
      <div id="digitDisplay" class="digit-hero">--</div>
      <div id="textDisplay" style="text-align: center; color: var(--text-muted); font-size: 0.95rem;">
        Click the button and say a number like "Three", "Seven", or "Ek"...
      </div>
    </div>

    <table class="meta-table">
      <tr><td>Server Status:</td><td id="metaStatus">Online</td></tr>
      <tr><td>Model Checkpoint:</td><td>gradient-queen/whisper-tiny-indian-digits-final</td></tr>
      <tr><td>Inference Latency:</td><td id="metaLatency">--</td></tr>
      <tr><td>API Endpoint:</td><td>POST /api/recognize</td></tr>
    </table>
  </div>

  <script>
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    const btn = document.getElementById('recordBtn');
    const digitDisplay = document.getElementById('digitDisplay');
    const textDisplay = document.getElementById('textDisplay');
    const latencyDisplay = document.getElementById('metaLatency');
    const badge = document.getElementById('statusBadge');

    fetch('/api/health')
      .then(r => r.json())
      .then(d => {
        badge.textContent = `Online (${d.device.toUpperCase()})`;
      })
      .catch(() => {
        badge.textContent = 'Offline';
        badge.style.background = 'rgba(239, 68, 68, 0.2)';
        badge.style.color = '#ef4444';
      });

    btn.onclick = async () => {
      if (!isRecording) {
        audioChunks = [];
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = sendAudio;
        mediaRecorder.start();
        isRecording = true;
        btn.classList.add('recording');
        btn.innerHTML = '<span>⏹️ Stop Recording</span>';
        textDisplay.textContent = 'Listening... Speak now!';
      } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        isRecording = false;
        btn.classList.remove('recording');
        btn.innerHTML = '<span>⏳ Processing...</span>';
      }
    };

    async function sendAudio() {
      const blob = new Blob(audioChunks, { type: 'audio/wav' });
      const fd = new FormData();
      fd.append('file', blob, 'speech.wav');

      try {
        const res = await fetch('/api/recognize', { method: 'POST', body: fd });
        const data = await res.json();
        btn.innerHTML = '<span>🎙️ Click to Speak (Say 1 to 10)</span>';
        if (data.status === 'success') {
          digitDisplay.textContent = data.digit ? data.digit : '❓';
          textDisplay.innerHTML = `Heard: <strong>"${data.raw || data.text}"</strong>`;
          latencyDisplay.textContent = `${data.latency_ms} ms (${data.device})`;
        } else {
          digitDisplay.textContent = '⚠️';
          textDisplay.textContent = data.message || 'Recognition failed';
        }
      } catch (err) {
        btn.innerHTML = '<span>🎙️ Click to Speak</span>';
        digitDisplay.textContent = '❌';
        textDisplay.textContent = 'Server connection error: ' + err.message;
      }
    }
  </script>
</body>
</html>
"""

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "127.0.0.1")
    print(f"\n[whisper_server] Starting server at http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, reload=False)
