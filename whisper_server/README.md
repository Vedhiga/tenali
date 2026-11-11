# Tenali Whisper Voice Recognition Server

Production FastAPI voice recognition service running the fine-tuned **Whisper-Tiny Indian Digits** model ([`gradient-queen/whisper-tiny-indian-digits-final`](https://huggingface.co/gradient-queen/whisper-tiny-indian-digits-final)).

Designed for **NumberTracingApp** and **SpaceMazeAdventure** to recognize spoken numbers (1 to 10) with sub-100ms latency.

---

## Features

- **Sub-100ms Inference**: Pre-warms weights into memory; executes fast forward-pass without cold starts.
- **Hardware Acceleration**: Automatically detects and utilizes NVIDIA CUDA GPU, Apple Silicon MPS, or multi-threaded CPU.
- **Accents & Phonetics**: Built-in multi-lingual normalizer handles Indian English acoustic variations (*"tree"*, *"won"*, *"ait"*) and regional terms (Hindi *ek, do, teen*, Tamil *ondru, rendu, moonu*, Telugu *okati, rendu, moodu*).
- **Zero CORS Hassle**: Configured to serve requests from any Tenali frontend (`localhost:5173`, `localhost:4000`, `tenali-one.vercel.app`, `tenali.fun`).
- **Interactive Browser Test Console**: Built-in test interface with audio VU feedback at `http://127.0.0.1:8000`.

---

## Quickstart

### 1. Install Dependencies
```bash
cd whisper_server
python -m pip install -r requirements.txt
```

### 2. Start Server
**Windows**:
```cmd
run_server.bat
```
*(or `python server.py`)*

**Linux / macOS**:
```bash
chmod +x run_server.sh
./run_server.sh
```

The server will be available at: **`http://127.0.0.1:8000`**  
Open `http://127.0.0.1:8000` in your browser to test live with your microphone!

---

## API Reference

### 1. Health Check
* **Endpoint**: `GET /api/health`
* **Response**:
```json
{
  "status": "ok",
  "service": "tenali-whisper-voice",
  "model_loaded": true,
  "model_name": "gradient-queen/whisper-tiny-indian-digits-final",
  "device": "cpu",
  "dtype": "torch.float32"
}
```

### 2. Recognize Spoken Number
* **Endpoint**: `POST /api/recognize`
* **Content-Type**: `multipart/form-data` with form key `file`, or binary body (`audio/wav`)
* **Response**:
```json
{
  "status": "success",
  "digit": 3,
  "text": "THREE (3)",
  "raw": "three",
  "latency_ms": 68.4,
  "device": "cpu"
}
```

---

## Production Deployment on `tenali.fun` (Option 1)

On the production Linux VPS:

1. Copy `whisper_server/` to `/var/www/tenali/whisper_server`.
2. Install the systemd service:
   ```bash
   sudo cp tenali-whisper.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now tenali-whisper
   ```
3. Configure Nginx reverse proxy:
   ```nginx
   location /api/recognize {
       proxy_pass http://127.0.0.1:8000/api/recognize;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_read_timeout 15s;
   }
   ```
