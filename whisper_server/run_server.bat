@echo off
title Tenali Whisper Voice Recognition Server
echo =====================================================================
echo  Starting Tenali Whisper Voice Recognition Service
echo  Endpoint: http://127.0.0.1:8000
echo =====================================================================
echo.

python -m pip show fastapi >nul 2>&1
if %errorlevel% neq 0 (
    echo [Notice] Installing required dependencies...
    python -m pip install -r requirements.txt
)

echo [Info] Launching FastAPI Whisper server...
python server.py
pause
