import React, { useState } from 'react';
import { validateEanInput, calculateEanCheckDigit } from '@shared/ean.ts';
import { triggerHaptic } from '../telegram.ts';
import type { BarcodeDetection } from '../barcodeReader.ts';

interface ManualBarcodeInputProps {
  onDetected: (detection: BarcodeDetection) => void;
}

const SAMPLE_CODES = [
  { label: 'EAN-13 (Германия)', code: '4006381333931' },
  { label: 'EAN-13 (Испания)', code: '8410100000008' },
  { label: 'EAN-13 (Россия)', code: '4600000000008' },
  { label: 'EAN-8', code: '40123455' },
];

export const ManualBarcodeInput: React.FC<ManualBarcodeInputProps> = ({ onDetected }) => {
  const [value, setValue] = useState('');
  const [submittedAttempt, setSubmittedAttempt] = useState(false);

  const validation = validateEanInput(value);
  const digitsOnly = value.replace(/\D/g, '');

  // If user typed 7 or 12 digits, calculate what the check digit should be
  const pendingCheckDigit =
    digitsOnly.length === 7 || digitsOnly.length === 12
      ? calculateEanCheckDigit(digitsOnly)
      : null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSubmittedAttempt(true);

    if (validation.isValid && validation.normalized) {
      triggerHaptic('success');
      onDetected({
        text: validation.normalized,
        format: validation.type || 'EAN-13',
        isValidEan: true,
        timestamp: Date.now(),
      });
      setValue('');
      setSubmittedAttempt(false);
    } else {
      triggerHaptic('error');
    }
  };

  const handleSelectSample = (code: string) => {
    setValue(code);
    setSubmittedAttempt(false);
    triggerHaptic('light');
  };

  return (
    <div className="flex flex-col items-center w-full max-w-sm">
      <form onSubmit={handleSubmit} className="w-full">
        {/* Input box */}
        <div className="bg-tg-secondary rounded-2xl p-4 border border-tg-hint/20">
          <label className="block text-xs font-semibold text-tg-hint uppercase tracking-wider mb-2">
            Цифры штрихкода (EAN-13 или EAN-8)
          </label>

          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              placeholder="Например, 4006381333931"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSubmittedAttempt(false);
              }}
              className="w-full bg-tg-bg text-tg-text text-lg sm:text-xl font-mono tracking-widest px-4 py-3 rounded-xl border border-tg-hint/30 focus:outline-none focus:ring-2 focus:ring-tg-button transition"
            />
            {value && (
              <button
                type="button"
                onClick={() => {
                  setValue('');
                  setSubmittedAttempt(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-tg-hint hover:text-tg-text p-1 text-sm"
              >
                ✕
              </button>
            )}
          </div>

          {/* Real-time hint or validation message */}
          <div className="mt-3 min-h-[22px] text-xs">
            {digitsOnly.length > 0 && !validation.isValid && (
              <div className="flex items-center justify-between text-tg-hint">
                <span>Введено цифр: {digitsOnly.length} (требуется 8 или 13)</span>
                {pendingCheckDigit !== null && (
                  <button
                    type="button"
                    onClick={() => setValue(digitsOnly + pendingCheckDigit)}
                    className="text-tg-link font-medium hover:underline"
                  >
                    + цифра {pendingCheckDigit}
                  </button>
                )}
              </div>
            )}

            {validation.isValid && (
              <p className="text-emerald-500 font-medium flex items-center gap-1">
                <span>✅</span>
                <span>
                  Корректный {validation.type} (контрольная цифра {validation.actualCheckDigit})
                </span>
              </p>
            )}

            {submittedAttempt && !validation.isValid && validation.error && (
              <p className="text-red-500 font-medium flex items-center gap-1">
                <span>❌</span>
                <span>{validation.error}</span>
              </p>
            )}
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={!validation.isValid}
            className="w-full mt-3 py-3 px-4 bg-tg-button text-tg-button font-medium rounded-xl text-sm shadow-sm active:opacity-85 transition disabled:opacity-40"
          >
            Применить штрихкод
          </button>
        </div>
      </form>

      {/* Quick samples for rapid testing */}
      <div className="w-full mt-4">
        <p className="text-xs text-tg-hint font-medium mb-2 px-1">
          Быстрые примеры для проверки:
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SAMPLE_CODES.map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => handleSelectSample(s.code)}
              className="py-2 px-3 bg-tg-secondary hover:bg-tg-secondary/70 border border-tg-hint/20 rounded-xl text-left text-xs transition"
            >
              <div className="font-medium text-tg-text">{s.label}</div>
              <div className="font-mono text-[11px] text-tg-hint">{s.code}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
