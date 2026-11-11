"""
whisper_server/test_client.py — Diagnostic CLI Test Client

Verifies:
1. /api/health endpoint
2. Synthetic 16kHz audio recognition against /api/recognize
3. Latency measurement
"""

import sys
import io
import time
import requests
import numpy as np
import soundfile as sf

SERVER_URL = "http://127.0.0.1:8000"

def test_server():
    print(f"[test_client] Probing {SERVER_URL}/api/health...")
    try:
        r = requests.get(f"{SERVER_URL}/api/health", timeout=3)
        if r.status_code == 200:
            print("[test_client] SUCCESS: Server is online!", r.json())
        else:
            print(f"[test_client] FAIL: Server responded with status {r.status_code}")
            return False
    except Exception as e:
        print(f"[test_client] FAIL: Cannot connect to {SERVER_URL}: {e}")
        return False

    print("\n[test_client] Generating 1.0s synthetic 16kHz test tone...")
    sample_rate = 16000
    duration = 1.0
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    # 440 Hz standard tone
    audio = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV")
    buf.seek(0)

    print("[test_client] Sending test audio to /api/recognize...")
    t0 = time.perf_counter()
    resp = requests.post(
        f"{SERVER_URL}/api/recognize",
        files={"file": ("synthetic_test.wav", buf, "audio/wav")},
        timeout=10
    )
    latency = round((time.perf_counter() - t0) * 1000, 1)

    print(f"[test_client] Response ({latency}ms):", resp.json())
    return True

if __name__ == "__main__":
    success = test_server()
    sys.exit(0 if success else 1)
