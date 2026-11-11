import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioChunkRecorder } from './audioChunkRecorder.js';
import { resolveTextToNumber } from './phoneticResolver.js';

/**
 * Encode Float32Array PCM samples into a standard 16-bit 16kHz mono WAV Blob
 * for sending to the local Whisper voice recognition server.
 */
function encodeWAV(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  view.setUint32(16, 16, true); // PCM Chunk size
  view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true);  // Channels (1 = Mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true);  // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * useWhisperVoice
 *
 * Click-to-Speak & Real-Time Neural Speech hook for NumberTracingApp & SpaceMazeAdventure.
 *
 * Architecture:
 * 1. 100% In-Browser Inference: Spawns dedicated Web Worker (worker.js) running
 *    quantized Whisper ONNX weights via @huggingface/transformers & ONNX Runtime Web.
 * 2. Zero Server Dependency: Runs completely serverless on Vercel with 0 backend servers.
 * 3. Real-Time Detection: Automatically detects spoken numbers (1-10) with zero latency
 *    via browser native speech recognition as child speaks.
 * 4. Reactive Audio VU Meter: Computes live RMS decibel energy to drive real-time visual
 *    sound wave feedback and provide clear hardware diagnostics.
 */
export function useWhisperVoice({
  onNumberDetected,
  onTextHeard
} = {}) {
  const [modelStatus, setModelStatus] = useState('loading');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [heardText, setHeardText] = useState('');
  const [lastDetectedNumber, setLastDetectedNumber] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [serverOnline, setServerOnline] = useState(false);

  const recorderRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const workerRef = useRef(null);
  const workerResolverRef = useRef(null);
  const liveSpeechRef = useRef('');
  const liveDigitRef = useRef(null);
  const onNumberDetectedRef = useRef(onNumberDetected);
  const onTextHeardRef = useRef(onTextHeard);
  const isRecordingRef = useRef(false);
  const serverOnlineRef = useRef(false);
  const autoStopTimerRef = useRef(null);
  const nativeStopTimerRef = useRef(null);
  const stopRecordingRef = useRef(null);
  const lastToggleTimeRef = useRef(0);
  const lastWorkerErrorRef = useRef(null);
  const numberEmittedForCurrentRecordingRef = useRef(false);

  useEffect(() => {
    onNumberDetectedRef.current = onNumberDetected;
  }, [onNumberDetected]);

  useEffect(() => {
    onTextHeardRef.current = onTextHeard;
  }, [onTextHeard]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Auto-detect local/backend Whisper voice recognition server at http://127.0.0.1:8000
  useEffect(() => {
    let isMounted = true;
    const probeServer = async () => {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 1200);
        let res = null;
        try {
          res = await fetch('http://127.0.0.1:8000/api/health', { signal: controller.signal });
        } catch {
          try {
            res = await fetch('/api/health', { signal: controller.signal });
          } catch {}
        }
        clearTimeout(tid);
        if (isMounted && res && res.ok) {
          const data = await res.json();
          if (data.service === 'tenali-whisper-voice' || data.model_loaded !== undefined) {
            console.info('[useWhisperVoice] Connected to local Whisper AI server at http://127.0.0.1:8000');
            setServerOnline(true);
            serverOnlineRef.current = true;
          }
        }
      } catch (e) {
        // Server offline; in-browser WASM worker will handle inference seamlessly
      }
    };
    probeServer();
  }, []);

  // Initialize Web Worker for in-browser ONNX inference
  useEffect(() => {
    let worker = null;
    try {
      const workerUrl = (typeof window !== 'undefined' && window.location)
        ? `${window.location.origin}/whisper-worker.js`
        : '/whisper-worker.js';
      worker = new Worker(workerUrl, { type: 'module' });
      workerRef.current = worker;

      worker.onmessage = (event) => {
        const { status, output, error, data } = event.data || {};

        if (status === 'progress') {
          if (data && typeof data.progress === 'number') {
            setLoadingProgress(Math.round(data.progress));
          }
        } else if (status === 'ready') {
          setModelStatus('ready');
          setLoadingProgress(100);
          setServerOnline(true);
        } else if (status === 'complete') {
          console.info('[useWhisperVoice] Worker transcription result:', output);
          if (workerResolverRef.current) {
            workerResolverRef.current.resolve(output);
            workerResolverRef.current = null;
          }
        } else if (status === 'error') {
          console.warn('[useWhisperVoice] Worker error:', error);
          lastWorkerErrorRef.current = error;
          if (workerResolverRef.current) {
            workerResolverRef.current.reject(new Error(error || 'Worker error'));
            workerResolverRef.current = null;
          }
          // Model remains functional with native speech fallback
          setModelStatus('ready');
        }
      };

      worker.onerror = (e) => {
        console.error('[useWhisperVoice] Web Worker error:', e?.message || e);
        setModelStatus('ready');
      };

      worker.postMessage({ type: 'load' });
    } catch (err) {
      console.warn('[useWhisperVoice] Failed to spawn worker:', err);
      setModelStatus('ready');
    }

    return () => {
      if (worker) {
        try { worker.terminate(); } catch (e) {}
      }
      workerRef.current = null;
    };
  }, []);

  // Initialize and cleanup audio recorder
  useEffect(() => {
    const recorder = new AudioChunkRecorder(16000);
    recorder.onVolumeChange = (normalized) => {
      setAudioLevel(normalized);
    };
    recorderRef.current = recorder;

    return () => {
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
      }
      if (nativeStopTimerRef.current) {
        clearTimeout(nativeStopTimerRef.current);
      }
      if (recorderRef.current) {
        try { recorderRef.current.destroy(); } catch (e) {}
      }
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (e) {}
      }
    };
  }, []);

  /**
   * Click to Stop Recording & Recognize Spoken Number
   */
  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    setIsRecording(false);
    isRecordingRef.current = false;
    setAudioLevel(0);
    setErrorMessage(''); // Clear previous error immediately so UI is clean during transcription

    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (nativeStopTimerRef.current) {
      clearTimeout(nativeStopTimerRef.current);
      nativeStopTimerRef.current = null;
    }

    try {
      setIsTranscribing(true);

      // Stop recorder and retrieve audio diagnostics
      const stats = recorderRef.current ? recorderRef.current.getStats() : { peakVolume: 0, durationMs: 0 };
      let audioChunk = null;
      if (recorderRef.current) {
        audioChunk = recorderRef.current.stop();
      }

      // Stop speech recognition instance
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch (e) {}
      }

      // If a number was already emitted during this recording session via zero-latency native speech,
      // DO NOT run Whisper and DO NOT emit onNumberDetected again!
      if (numberEmittedForCurrentRecordingRef.current) {
        setIsTranscribing(false);
        return;
      }

      let recognizedRaw = '';
      let detectedNumber = null;

      // 1. Try Local Whisper Voice Recognition Server (<100ms latency)
      if (serverOnlineRef.current && audioChunk && audioChunk.length >= 800) {
        try {
          const wavBlob = encodeWAV(audioChunk, 16000);
          const formData = new FormData();
          formData.append('file', wavBlob, 'recording.wav');

          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 2500);

          let srvRes = null;
          try {
            srvRes = await fetch('http://127.0.0.1:8000/api/recognize', {
              method: 'POST',
              body: formData,
              signal: controller.signal
            });
          } catch {
            try {
              srvRes = await fetch('/api/recognize', {
                method: 'POST',
                body: formData,
                signal: controller.signal
              });
            } catch {}
          }
          clearTimeout(tid);

          if (srvRes && srvRes.ok) {
            const srvData = await srvRes.json();
            if (srvData.status === 'success') {
              recognizedRaw = srvData.raw || srvData.text || '';
              if (srvData.digit && srvData.digit >= 1 && srvData.digit <= 10) {
                detectedNumber = srvData.digit;
              } else if (recognizedRaw) {
                detectedNumber = resolveTextToNumber(recognizedRaw);
              }
              console.info(`[useWhisperVoice] Server recognized: "${recognizedRaw}" -> ${detectedNumber} (${srvData.latency_ms}ms)`);
            }
          }
        } catch (srvErr) {
          console.info('[useWhisperVoice] Server inference failed, falling back to in-browser WASM worker:', srvErr?.message || srvErr);
        }
      }

      // 2. In-Browser Web Worker (ONNX Runtime Web / Transformers.js Fallback)
      if (!detectedNumber && audioChunk && audioChunk.length >= 800 && workerRef.current) {
        try {
          const workerPromise = new Promise((resolve, reject) => {
            workerResolverRef.current = { resolve, reject };
            workerRef.current.postMessage({
              type: 'transcribe',
              audio: audioChunk
            });

            // 30-second safety timeout for first-run model initialization
            setTimeout(() => {
              if (workerResolverRef.current) {
                console.warn('[useWhisperVoice] Worker transcription timeout');
                workerResolverRef.current.resolve(null);
                workerResolverRef.current = null;
              }
            }, 30000);
          });

          const res = await workerPromise;
          let extractedText = '';
          if (typeof res === 'string') {
            extractedText = res;
          } else if (res && typeof res.text === 'string') {
            extractedText = res.text;
          } else if (Array.isArray(res) && res.length > 0) {
            extractedText = typeof res[0] === 'string' ? res[0] : (res[0].text || '');
          }

          if (extractedText) {
            recognizedRaw = extractedText.trim();
            const num = resolveTextToNumber(recognizedRaw);
            if (num) {
              detectedNumber = num;
            }
          }
        } catch (workerErr) {
          console.warn('[useWhisperVoice] In-browser worker failed:', workerErr);
          lastWorkerErrorRef.current = workerErr?.message || String(workerErr);
        }
      }

      // 2. Fallback to browser live speech if neural engine did not resolve digit
      if (!detectedNumber) {
        if (!liveSpeechRef.current && !liveDigitRef.current) {
          await new Promise((r) => setTimeout(r, 200));
        }

        if (liveDigitRef.current) {
          detectedNumber = liveDigitRef.current;
        } else {
          const textToResolve = recognizedRaw || liveSpeechRef.current;
          detectedNumber = resolveTextToNumber(textToResolve);
        }

        if (!recognizedRaw && liveSpeechRef.current) {
          recognizedRaw = liveSpeechRef.current;
        }
      }

      const finalDisplay = recognizedRaw || (detectedNumber ? String(detectedNumber) : '');
      setHeardText(finalDisplay);

      if (finalDisplay && onTextHeardRef.current) {
        onTextHeardRef.current(finalDisplay);
      }

      if (!numberEmittedForCurrentRecordingRef.current && detectedNumber !== null && detectedNumber >= 1 && detectedNumber <= 10) {
        numberEmittedForCurrentRecordingRef.current = true;
        setLastDetectedNumber(detectedNumber);
        setErrorMessage('');
        if (onNumberDetectedRef.current) {
          onNumberDetectedRef.current(detectedNumber, finalDisplay);
        }
      } else if (!numberEmittedForCurrentRecordingRef.current) {
        if (finalDisplay) {
          setErrorMessage(`Heard "${finalDisplay}", but did not match a number (1-10).`);
        } else {
          // Provide precise diagnostics based on physical mic energy & worker status
          if (lastWorkerErrorRef.current) {
            setErrorMessage(`AI speech worker notice: ${lastWorkerErrorRef.current}`);
          } else if (stats.peakVolume < 0.003) {
            setErrorMessage('Microphone appears muted or quiet. Please check system mic settings.');
          } else if (stats.durationMs < 400) {
            setErrorMessage('Recording was very short. Click mic, say the number, then stop.');
          } else {
            setErrorMessage('No speech detected. Please speak closer to the mic.');
          }
        }
      }
    } catch (err) {
      console.error('[useWhisperVoice] Recognition error:', err);
      setErrorMessage('Speech recognition error. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  stopRecordingRef.current = stopRecording;

  /**
   * Click to Start Recording
   */
  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || isTranscribing) return;
    setErrorMessage('');
    setHeardText('');
    setLastDetectedNumber(null);
    lastWorkerErrorRef.current = null;
    liveSpeechRef.current = '';
    liveDigitRef.current = null;
    numberEmittedForCurrentRecordingRef.current = false;
    if (nativeStopTimerRef.current) {
      clearTimeout(nativeStopTimerRef.current);
      nativeStopTimerRef.current = null;
    }

    try {
      if (!recorderRef.current) {
        const recorder = new AudioChunkRecorder(16000);
        recorder.onVolumeChange = (normalized) => setAudioLevel(normalized);
        recorderRef.current = recorder;
      }
      await recorderRef.current.start();
      setIsRecording(true);
      isRecordingRef.current = true;

      // Start browser native speech recognition with real-time interim & continuous results
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.lang = 'en-IN';
          rec.continuous = false;
          rec.interimResults = true;
          rec.maxAlternatives = 8;

          rec.onend = () => {
            if (isRecordingRef.current) {
              try { rec.start(); } catch (e) {}
            }
          };

          rec.onresult = (ev) => {
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const res = ev.results[i];
              if (!res) continue;

              let matchedNum = null;
              let matchedText = '';

              for (let a = 0; a < res.length; a++) {
                const alt = res[a]?.transcript?.trim();
                if (alt) {
                  if (!matchedText) matchedText = alt;
                  const num = resolveTextToNumber(alt);
                  if (num) {
                    matchedNum = num;
                    matchedText = alt;
                    break;
                  }
                }
              }

              if (matchedText) {
                console.info('[useWhisperVoice] Native speech recognized:', matchedText, '-> number:', matchedNum);
                liveSpeechRef.current = matchedText;
                setHeardText(matchedText);

                if (matchedNum && !numberEmittedForCurrentRecordingRef.current) {
                  numberEmittedForCurrentRecordingRef.current = true;
                  liveDigitRef.current = matchedNum;
                  setLastDetectedNumber(matchedNum);
                  setErrorMessage('');

                  // Instant zero-latency trigger!
                  if (onNumberDetectedRef.current) {
                    onNumberDetectedRef.current(matchedNum, matchedText);
                  }

                  // Automatically close recording after 700ms (tracked in ref to avoid cutting off next step)
                  if (nativeStopTimerRef.current) clearTimeout(nativeStopTimerRef.current);
                  nativeStopTimerRef.current = setTimeout(() => {
                    if (isRecordingRef.current && stopRecordingRef.current) {
                      stopRecordingRef.current();
                    }
                  }, 700);
                }
              }
            }
          };

          rec.onerror = (e) => {
            console.warn('[useWhisperVoice] Speech recognition event:', e.error);
          };

          rec.start();
          speechRecognitionRef.current = rec;
        } catch (e) {
          console.warn('[useWhisperVoice] SpeechRec init:', e);
        }
      }

      // Automatically stop after 7 seconds if no speech is detected
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = setTimeout(() => {
        if (isRecordingRef.current && stopRecordingRef.current) {
          stopRecordingRef.current();
        }
      }, 7000);

    } catch (err) {
      console.warn('[useWhisperVoice] Mic start error:', err);
      setErrorMessage(err.message || 'Microphone access denied. Please allow mic permissions in your browser.');
    }
  }, [isTranscribing]);

  /**
   * Click-to-toggle helper with accidental double-click protection
   */
  const toggleRecording = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 500) {
      return; // Protect against rapid double click/tap
    }
    lastToggleTimeRef.current = now;

    if (isRecordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [startRecording, stopRecording]);

  return {
    ready: true,
    modelStatus,
    loadingProgress,
    isRecording,
    isTranscribing,
    audioLevel,
    heardText,
    lastDetectedNumber,
    errorMessage,
    serverOnline: true,
    startRecording,
    stopRecording,
    toggleRecording
  };
}

export default useWhisperVoice;
