import React, { useState, useRef, useEffect, useCallback } from 'react';
import { recognizeDateFromCanvas, recognizeDateFromFile } from '../ocrReader.ts';
import { type DateCandidate } from '@shared/ocr.ts';
import { t, type SupportedLanguage } from '@shared/i18n.ts';
import { triggerHaptic } from '../telegram.ts';

interface OcrDateScannerModalProps {
  isOpen: boolean;
  lang: SupportedLanguage;
  onClose: () => void;
  onDateSelected: (dateIso: string) => void;
}

export const OcrDateScannerModal: React.FC<OcrDateScannerModalProps> = ({
  isOpen,
  lang,
  onClose,
  onDateSelected,
}) => {
  const [activeTab, setActiveTab] = useState<'camera' | 'photo'>('camera');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [candidates, setCandidates] = useState<DateCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  // Live Camera refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);

  // File input refs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Stop camera stream cleanly
  const stopStream = useCallback(() => {
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

  // Start camera stream for live mode
  const startCamera = useCallback(async () => {
    stopStream();
    setCameraError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(t(lang, 'scanner_unsupported'));
      setActiveTab('photo');
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
      }
    } catch (err: unknown) {
      console.warn('OCR Camera access error:', err);
      const isNotAllowed = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setCameraError(isNotAllowed ? t(lang, 'scanner_permission_denied') : t(lang, 'scanner_device_not_found'));
      // Fallback to photo picker
      setActiveTab('photo');
    }
  }, [lang, stopStream]);

  // Manage camera lifecycle
  useEffect(() => {
    if (isOpen && activeTab === 'camera' && !hasScanned) {
      startCamera();
    } else {
      stopStream();
    }

    return () => {
      stopStream();
    };
  }, [isOpen, activeTab, hasScanned, startCamera, stopStream]);

  // Clean up preview URL on close or reset
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!isOpen) return null;

  const resetScan = () => {
    setHasScanned(false);
    setCandidates([]);
    setSelectedCandidate(null);
    setRawText(null);
    setProgress(0);
    setStatusMessage('');
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (activeTab === 'camera') {
      startCamera();
    }
  };

  // Capture frame from live video viewfinder
  const handleCaptureVideo = async () => {
    if (!videoRef.current || !viewfinderRef.current) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    triggerHaptic('light');
    setIsProcessing(true);
    setProgress(0.1);
    setStatusMessage(t(lang, 'ocr_processing'));

    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = video.videoWidth;
      offscreen.height = video.videoHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('Could not get 2d context');

      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

      // Compute viewfinder relative crop
      const videoRect = video.getBoundingClientRect();
      const vfRect = viewfinderRef.current.getBoundingClientRect();

      const scaleX = video.videoWidth / videoRect.width;
      const scaleY = video.videoHeight / videoRect.height;

      const cropX = Math.max(0, Math.round((vfRect.left - videoRect.left) * scaleX));
      const cropY = Math.max(0, Math.round((vfRect.top - videoRect.top) * scaleY));
      const cropW = Math.min(video.videoWidth - cropX, Math.round(vfRect.width * scaleX));
      const cropH = Math.min(video.videoHeight - cropY, Math.round(vfRect.height * scaleY));

      stopStream();

      // Create snapshot preview URL
      offscreen.toBlob((blob) => {
        if (blob) {
          setPreviewUrl(URL.createObjectURL(blob));
        }
      }, 'image/jpeg');

      const result = await recognizeDateFromCanvas(
        offscreen,
        { x: cropX, y: cropY, width: cropW, height: cropH },
        (p, status) => {
          setProgress(p);
          setStatusMessage(status);
        },
        lang
      );

      setRawText(result.rawText);
      setCandidates(result.candidates);
      if (result.candidates.length > 0) {
        setSelectedCandidate(result.candidates[0].date);
        triggerHaptic('success');
      } else {
        triggerHaptic('warning');
      }
      setHasScanned(true);
    } catch (err) {
      console.error('OCR Video capture error:', err);
      triggerHaptic('error');
      setCandidates([]);
      setHasScanned(true);
    } finally {
      setIsProcessing(false);
    }
  };

  // Process image from file (camera snapshot or gallery)
  const handleProcessFile = async (file: File) => {
    triggerHaptic('light');
    setIsProcessing(true);
    setProgress(0.1);
    setStatusMessage(t(lang, 'ocr_processing'));

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    try {
      const result = await recognizeDateFromFile(
        file,
        undefined,
        (p, status) => {
          setProgress(p);
          setStatusMessage(status);
        },
        lang
      );

      setRawText(result.rawText);
      setCandidates(result.candidates);
      if (result.candidates.length > 0) {
        setSelectedCandidate(result.candidates[0].date);
        triggerHaptic('success');
      } else {
        triggerHaptic('warning');
      }
      setHasScanned(true);
    } catch (err) {
      console.error('OCR File error:', err);
      triggerHaptic('error');
      setCandidates([]);
      setHasScanned(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmDate = () => {
    if (!selectedCandidate) return;
    triggerHaptic('success');
    onDateSelected(selectedCandidate);
    onClose();
  };

  const formatDateDisplay = (isoStr: string) => {
    try {
      const parts = isoStr.split('-');
      if (parts.length === 3) {
        const d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
        return d.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-US' : 'ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        });
      }
    } catch {
      // Fallback
    }
    return isoStr;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-tg-bg text-tg-text rounded-t-3xl sm:rounded-2xl border border-tg-hint/20 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-slide-up">
        {/* Header */}
        <div className="p-4 border-b border-tg-hint/15 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔍</span>
            <div>
              <h2 className="font-bold text-sm text-tg-text">{t(lang, 'ocr_modal_title')}</h2>
              <p className="text-[11px] text-tg-hint">{t(lang, 'ocr_photo_prompt')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-tg-secondary text-tg-hint hover:text-tg-text flex items-center justify-center text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* Hidden File Inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleProcessFile(file);
          }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleProcessFile(file);
          }}
        />

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Mode Switcher Tabs (when not scanned yet) */}
          {!hasScanned && (
            <div className="flex bg-tg-secondary p-1 rounded-xl border border-tg-hint/15 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('camera');
                  triggerHaptic('light');
                }}
                className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center gap-1.5 ${
                  activeTab === 'camera'
                    ? 'bg-tg-button text-tg-button shadow-xs'
                    : 'text-tg-hint hover:text-tg-text'
                }`}
              >
                <span>📹</span>
                <span>{t(lang, 'mode_live')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('photo');
                  stopStream();
                  triggerHaptic('light');
                }}
                className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center gap-1.5 ${
                  activeTab === 'photo'
                    ? 'bg-tg-button text-tg-button shadow-xs'
                    : 'text-tg-hint hover:text-tg-text'
                }`}
              >
                <span>📷</span>
                <span>{t(lang, 'mode_photo')}</span>
              </button>
            </div>
          )}

          {/* 1. Camera Viewfinder Mode */}
          {!hasScanned && activeTab === 'camera' && (
            <div className="space-y-3">
              <div className="relative w-full aspect-[4/3] bg-black rounded-2xl overflow-hidden border border-tg-hint/25 flex items-center justify-center">
                {cameraError ? (
                  <div className="p-4 text-center text-xs text-tg-hint space-y-2">
                    <p className="text-amber-500 font-semibold">⚠️ {cameraError}</p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('photo')}
                      className="px-3 py-1.5 rounded-lg bg-tg-button text-tg-button font-bold text-xs"
                    >
                      {t(lang, 'mode_photo')}
                    </button>
                  </div>
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                    />

                    {/* Viewfinder Target Bounding Frame */}
                    <div
                      ref={viewfinderRef}
                      className="absolute w-[80%] h-[35%] rounded-xl border-2 border-emerald-400/90 shadow-[0_0_15px_rgba(52,211,153,0.35)] pointer-events-none flex items-center justify-center"
                    >
                      <div className="absolute top-1 left-2 text-[10px] text-emerald-400 font-mono font-bold bg-black/60 px-1 rounded">
                        Срок годности
                      </div>
                      <div className="w-full border-t border-dashed border-emerald-400/40" />
                    </div>
                  </>
                )}

                {/* Processing Overlay */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center gap-3 p-4 text-center">
                    <div className="w-10 h-10 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    <div className="space-y-1 w-full max-w-[200px]">
                      <p className="text-xs font-bold text-white">{statusMessage || t(lang, 'ocr_processing')}</p>
                      <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 transition-all duration-300"
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Live Capture Button */}
              {!cameraError && (
                <button
                  type="button"
                  onClick={handleCaptureVideo}
                  disabled={isProcessing}
                  className="w-full py-3 px-4 rounded-xl bg-tg-button text-tg-button font-bold text-sm shadow-md active:scale-[0.98] transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>📸</span>
                  <span>{t(lang, 'ocr_snap_and_read')}</span>
                </button>
              )}
            </div>
          )}

          {/* 2. Photo / File Mode */}
          {!hasScanned && activeTab === 'photo' && (
            <div className="space-y-3">
              <div className="relative w-full aspect-[4/3] bg-tg-secondary rounded-2xl overflow-hidden border border-tg-hint/25 flex flex-col items-center justify-center p-4 text-center">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={t(lang, 'mode_photo')}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-4xl">📸</span>
                    <p className="text-xs font-semibold text-tg-text">
                      {t(lang, 'ocr_photo_prompt')}
                    </p>
                    <p className="text-[11px] text-tg-hint">
                      Чётко сфотографируйте штамп с датой (DD.MM.YYYY или MM.YYYY)
                    </p>
                  </div>
                )}

                {/* Processing Overlay */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center gap-3 p-4 text-center">
                    <div className="w-10 h-10 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    <div className="space-y-1 w-full max-w-[200px]">
                      <p className="text-xs font-bold text-white">{statusMessage || t(lang, 'ocr_processing')}</p>
                      <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 transition-all duration-300"
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={isProcessing}
                  className="py-3 px-3 rounded-xl bg-tg-button text-tg-button font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition disabled:opacity-50"
                >
                  <span>📷</span>
                  <span>{t(lang, 'ocr_camera_btn')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={isProcessing}
                  className="py-3 px-3 rounded-xl bg-tg-secondary text-tg-text font-bold text-xs border border-tg-hint/20 flex items-center justify-center gap-1.5 active:scale-95 transition disabled:opacity-50"
                >
                  <span>🖼️</span>
                  <span>{t(lang, 'ocr_gallery_btn')}</span>
                </button>
              </div>
            </div>
          )}

          {/* 3. OCR Candidates Confirmation Screen */}
          {hasScanned && (
            <div className="space-y-3 animate-fade-in">
              {candidates.length > 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-tg-text">
                      {t(lang, 'ocr_candidates_title')}
                    </label>
                    <span className="text-[10px] text-tg-hint font-medium">
                      Найдено: {candidates.length}
                    </span>
                  </div>

                  {/* List of candidates */}
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {candidates.map((cand) => {
                      const isSelected = selectedCandidate === cand.date;
                      return (
                        <div
                          key={cand.date}
                          onClick={() => {
                            setSelectedCandidate(cand.date);
                            triggerHaptic('light');
                          }}
                          className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                            isSelected
                              ? 'bg-emerald-500/15 border-emerald-500 text-tg-text shadow-sm'
                              : 'bg-tg-secondary border-tg-hint/15 text-tg-text hover:border-tg-hint/30'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-emerald-400">
                                {formatDateDisplay(cand.date)}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold bg-tg-bg text-tg-hint border border-tg-hint/15">
                                {cand.format}
                              </span>
                            </div>
                            <p className="text-[11px] text-tg-hint">
                              Текст на упаковке: <span className="font-mono text-tg-text">«{cand.rawMatch}»</span>
                            </p>
                          </div>

                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-tg-hint/40'
                          }`}>
                            {isSelected && <span className="text-xs font-bold">✓</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-tg-hint flex items-center gap-1">
                    <span>💡</span>
                    <span>{t(lang, 'ocr_select_hint')}</span>
                  </p>
                </>
              ) : (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2 text-xs">
                  <p className="font-bold text-amber-500 flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>{t(lang, 'ocr_date_not_found')}</span>
                  </p>
                  <p className="text-tg-hint leading-relaxed">
                    {t(lang, 'ocr_no_candidates')}
                  </p>
                </div>
              )}

              {/* Optional Collapsible Raw OCR text */}
              {rawText && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowRawText(!showRawText)}
                    className="text-[11px] text-tg-hint hover:text-tg-text flex items-center gap-1"
                  >
                    <span>{showRawText ? t(lang, 'ocr_hide_raw_text') : t(lang, 'ocr_show_raw_text')}</span>
                  </button>
                  {showRawText && (
                    <div className="mt-1 p-2 bg-tg-secondary rounded-lg border border-tg-hint/15 text-[10px] font-mono text-tg-hint whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                      {rawText.trim() || t(lang, 'ocr_empty_text')}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons for Results */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={resetScan}
                  className="flex-1 py-3 px-3 rounded-xl bg-tg-secondary text-tg-text font-medium text-xs transition"
                >
                  🔄 {t(lang, 'btn_retry')}
                </button>
                {candidates.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleConfirmDate}
                    disabled={!selectedCandidate}
                    className="flex-2 py-3 px-3 rounded-xl bg-tg-button text-tg-button font-bold text-xs transition shadow-md active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <span>✓</span>
                    <span>{t(lang, 'ocr_confirm_btn')}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-2 py-3 px-3 rounded-xl bg-tg-button text-tg-button font-bold text-xs transition shadow-md"
                  >
                    {t(lang, 'ocr_enter_manual')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
