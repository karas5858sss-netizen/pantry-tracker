import React, { useRef, useState } from 'react';
import { decodeFromFile, type BarcodeDetection } from '../barcodeReader.ts';
import { triggerHaptic } from '../telegram.ts';
import { t, type SupportedLanguage } from '@shared/i18n.ts';

interface PhotoScannerProps {
  lang?: SupportedLanguage;
  onDetected: (detection: BarcodeDetection) => void;
  onSwitchToManual: () => void;
}

export const PhotoScanner: React.FC<PhotoScannerProps> = ({ lang = 'ru', onDetected, onSwitchToManual }) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setErrorStatus(null);

    // Show instant preview
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    try {
      const detection = await decodeFromFile(file);

      if (detection) {
        triggerHaptic('success');
        onDetected(detection);
      } else {
        triggerHaptic('warning');
        setErrorStatus(t(lang, 'scanner_not_found'));
      }
    } catch (err) {
      console.error('Photo processing failed:', err);
      triggerHaptic('error');
      setErrorStatus(t(lang, 'scanner_error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-sm">
      {/* Hidden inputs */}
      {/* 1. Camera snapshot with capture="environment" */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      {/* 2. Gallery picker */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Preview Card */}
      <div className="w-full aspect-[4/3] bg-tg-secondary rounded-2xl overflow-hidden border border-tg-hint/20 flex flex-col items-center justify-center relative p-3 text-center">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={t(lang, 'mode_photo')}
            className="w-full h-full object-contain rounded-xl"
          />
        ) : (
          <div className="flex flex-col items-center p-4">
            <div className="text-4xl mb-3">📸</div>
            <p className="text-sm font-medium text-tg-text mb-1">
              {t(lang, 'scanner_photo_prompt')}
            </p>
            <p className="text-xs text-tg-hint">
              {t(lang, 'scanner_photo_subtitle')}
            </p>
          </div>
        )}

        {/* Loading overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <div className="w-8 h-8 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-2" />
            <span className="text-xs font-medium">{t(lang, 'scan_barcode_recognizing')}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="w-full grid grid-cols-2 gap-2.5 mt-3">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isProcessing}
          className="flex items-center justify-center gap-1.5 py-3 px-4 bg-tg-button text-tg-button font-medium rounded-xl text-sm shadow-sm active:opacity-85 transition disabled:opacity-50"
        >
          <span>📷</span>
          <span>{t(lang, 'scan_photo_take')}</span>
        </button>

        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          disabled={isProcessing}
          className="flex items-center justify-center gap-1.5 py-3 px-4 bg-tg-secondary text-tg-text font-medium rounded-xl text-sm border border-tg-hint/20 active:opacity-85 transition disabled:opacity-50"
        >
          <span>🖼️</span>
          <span>{t(lang, 'scan_photo_gallery')}</span>
        </button>
      </div>

      {/* Warning / Error Notification */}
      {errorStatus && (
        <div className="w-full mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-tg-text text-left">
          <p className="font-semibold text-amber-500 mb-1 flex items-center gap-1">
            <span>⚠️</span>
            <span>{t(lang, 'scan_photo_failed')}</span>
          </p>
          <p className="text-tg-hint leading-relaxed">{errorStatus}</p>
          <button
            type="button"
            onClick={onSwitchToManual}
            className="mt-2 text-tg-link font-medium hover:underline block"
          >
            {t(lang, 'scan_photo_switch_manual')}
          </button>
        </div>
      )}
    </div>
  );
};
