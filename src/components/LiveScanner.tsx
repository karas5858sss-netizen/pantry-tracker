import React, { useEffect, useRef, useState, useCallback } from 'react';
import { decodeFromCanvas, type BarcodeDetection } from '../barcodeReader.ts';
import { triggerHaptic, playScanBeep } from '../telegram.ts';
import { t, type SupportedLanguage } from '../../shared/i18n.ts';

interface LiveScannerProps {
  lang?: SupportedLanguage;
  onDetected: (detection: BarcodeDetection) => void;
  onSwitchToPhoto: () => void;
}

export const LiveScanner: React.FC<LiveScannerProps> = ({ lang = 'ru', onDetected, onSwitchToPhoto }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ width: number; height: number; fps?: number } | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [flashSuccess, setFlashSuccess] = useState(false);
  const [activeBadge, setActiveBadge] = useState<BarcodeDetection | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isDecodingRef = useRef(false);
  const decodeStartTimeRef = useRef(0);
  const lastScanTimeRef = useRef(0);
  const lastScannedRef = useRef<string | null>(null);
  const badgeTimerRef = useRef<number | null>(null);

  // Stop camera stream cleanly
  const stopStream = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('Track stop error:', e);
        }
      });
      streamRef.current = null;
    }
  }, []);

  // Toggle torch/flashlight if supported
  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
      const nextState = !torchOn;
      // @ts-expect-error torch is standard in mobile browsers but not all TS DOM definitions
      await videoTrack.applyConstraints({ advanced: [{ torch: nextState }] });
      setTorchOn(nextState);
      triggerHaptic('light');
    } catch (err) {
      console.warn('Torch toggle failed:', err);
    }
  }, [torchOn]);

  // Start camera stream
  const startCamera = useCallback(async () => {
    stopStream();
    setErrorMessage(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage(t(lang, 'scanner_unsupported'));
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities = (videoTrack.getCapabilities ? videoTrack.getCapabilities() : {}) as { torch?: boolean };
        if (capabilities.torch) {
          setHasTorch(true);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.muted = true;

        await videoRef.current.play();

        setStreamInfo({
          width: videoRef.current.videoWidth,
          height: videoRef.current.videoHeight,
        });
      }
    } catch (err: unknown) {
      console.error('Camera access error:', err);
      const e = err as Error;
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setErrorMessage(t(lang, 'scanner_permission_denied'));
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        setErrorMessage(t(lang, 'scanner_device_not_found'));
      } else {
        setErrorMessage(t(lang, 'scanner_camera_launch_error', { error: e.message || '' }));
      }
    }
  }, [stopStream]);

  // Continuous scan loop with robust watchdog and immediate execution
  useEffect(() => {
    let active = true;

    const scanFrame = async () => {
      if (!active) return;

      const now = performance.now();
      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Watchdog: If decoding has been stuck for > 1500ms, unblock it
      if (isDecodingRef.current && now - decodeStartTimeRef.current > 1500) {
        isDecodingRef.current = false;
      }

      // Check if video is actively playing with valid dimensions
      if (
        isScanning &&
        !isDecodingRef.current &&
        video &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        canvas &&
        now - lastScanTimeRef.current > 120
      ) {
        // If browser paused video in background, resume it
        if (video.paused) {
          video.play().catch(() => {});
        }

        lastScanTimeRef.current = now;
        decodeStartTimeRef.current = now;
        isDecodingRef.current = true;

        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;

          canvas.width = vw;
          canvas.height = vh;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, vw, vh);
            const result = await decodeFromCanvas(canvas);

            if (result && active) {
              if (result.text !== lastScannedRef.current) {
                lastScannedRef.current = result.text;

                // Audio, physical haptic, and visual feedback
                playScanBeep();
                triggerHaptic('heavy');
                setTimeout(() => triggerHaptic('success'), 60);

                setFlashSuccess(true);
                setTimeout(() => setFlashSuccess(false), 500);

                setActiveBadge(result);
                if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
                badgeTimerRef.current = window.setTimeout(() => {
                  setActiveBadge(null);
                }, 4000);

                onDetected(result);
              }
            }
          }
        } catch (scanErr) {
          console.debug('Frame scan error:', scanErr);
        } finally {
          isDecodingRef.current = false;
        }
      }

      if (active) {
        animationFrameRef.current = requestAnimationFrame(scanFrame);
      }
    };

    animationFrameRef.current = requestAnimationFrame(scanFrame);

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (badgeTimerRef.current) {
        clearTimeout(badgeTimerRef.current);
      }
    };
  }, [isScanning, onDetected]);

  useEffect(() => {
    startCamera();
    return () => {
      stopStream();
    };
  }, [startCamera, stopStream]);

  return (
    <div className="flex flex-col items-center w-full">
      {/* Video Container */}
      <div
        className={`relative w-full max-w-sm aspect-[4/3] sm:aspect-square bg-black rounded-2xl overflow-hidden shadow-lg border-2 transition-all duration-300 ${
          flashSuccess
            ? 'border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.8)] scale-[1.01]'
            : 'border-neutral-800'
        }`}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
          onLoadedMetadata={() => {
            if (videoRef.current) {
              setStreamInfo({
                width: videoRef.current.videoWidth,
                height: videoRef.current.videoHeight,
              });
              videoRef.current.play().catch(() => {});
            }
          }}
          onCanPlay={() => {
            if (videoRef.current?.paused) {
              videoRef.current.play().catch(() => {});
            }
          }}
        />

        {/* Hidden offscreen canvas */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder Overlay */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div
            className={`relative w-3/4 h-2/3 max-w-[280px] max-h-[180px] border-2 rounded-xl overflow-hidden shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-colors duration-200 ${
              flashSuccess ? 'border-emerald-300 bg-emerald-500/20' : 'border-white/70'
            }`}
          >
            {/* Corner highlights */}
            <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-emerald-400 rounded-tl-sm" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-emerald-400 rounded-tr-sm" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-emerald-400 rounded-bl-sm" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-emerald-400 rounded-br-sm" />

            {/* Laser line */}
            <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent scan-laser shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          </div>
        </div>

        {/* Instant floating notification badge directly over viewfinder */}
        {activeBadge && (
          <div className="absolute bottom-3 left-3 right-3 bg-black/85 backdrop-blur-md border border-emerald-400/60 rounded-xl p-2.5 text-white flex items-center justify-between shadow-2xl animate-bounce-short">
            <div className="flex items-center gap-2">
              <span className="text-xl">✅</span>
              <div>
                <div className="font-mono font-bold text-base tracking-wider text-emerald-300">
                  {activeBadge.text}
                </div>
                <div className="text-[10px] text-neutral-300">
                  {activeBadge.format} • {t(lang, 'barcode_checksum_valid')}
                </div>
              </div>
            </div>
            <span className="text-[10px] uppercase font-semibold px-2 py-0.5 bg-emerald-500/30 text-emerald-200 rounded">
              {t(lang, 'barcode_read')}
            </span>
          </div>
        )}

        {/* Stream info badge */}
        {streamInfo && (
          <div className="absolute top-2.5 left-2.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-mono text-white/80 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              {streamInfo.width}×{streamInfo.height}
            </span>
          </div>
        )}

        {/* Flashlight button */}
        {hasTorch && (
          <button
            type="button"
            onClick={toggleTorch}
            className={`absolute top-2.5 right-2.5 p-2 rounded-full backdrop-blur-md transition ${
              torchOn ? 'bg-amber-400 text-black' : 'bg-black/60 text-white hover:bg-black/80'
            }`}
            title={t(lang, 'btn_torch')}
          >
            🔦
          </button>
        )}

        {/* Error overlay */}
        {errorMessage && (
          <div className="absolute inset-0 bg-black/90 p-6 flex flex-col items-center justify-center text-center">
            <div className="text-3xl mb-2">⚠️</div>
            <p className="text-sm text-red-400 font-medium mb-4">{errorMessage}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startCamera}
                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg text-xs font-semibold"
              >
                {t(lang, 'btn_retry')}
              </button>
              <button
                type="button"
                onClick={onSwitchToPhoto}
                className="px-4 py-2 bg-tg-button text-tg-button rounded-lg text-xs font-semibold"
              >
                {t(lang, 'mode_photo')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Control buttons under scanner */}
      <div className="w-full max-w-sm mt-3 flex items-center justify-between text-xs px-1">
        <button
          type="button"
          onClick={() => {
            setIsScanning(!isScanning);
            lastScannedRef.current = null;
          }}
          className="text-tg-hint hover:text-tg-text flex items-center gap-1 font-medium transition"
        >
          {isScanning ? `⏸ ${t(lang, 'scanner_pause')}` : `▶️ ${t(lang, 'scanner_resume')}`}
        </button>

        <button
          type="button"
          onClick={() => {
            lastScannedRef.current = null;
            startCamera();
          }}
          className="text-tg-link hover:underline font-medium"
        >
          🔄 {t(lang, 'scanner_restart')}
        </button>
      </div>
    </div>
  );
};
