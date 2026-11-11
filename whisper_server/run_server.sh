#!/bin/bash
# run_server.sh — Launch Tenali Whisper Voice Recognition Service on Linux/macOS

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "====================================================================="
echo " Starting Tenali Whisper Voice Recognition Service"
echo " Endpoint: http://127.0.0.1:8000"
echo "====================================================================="

if [ -d "venv" ]; then
    source venv/bin/activate
fi

python3 -m pip install -q -r requirements.txt

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8000}"

exec python3 server.py
