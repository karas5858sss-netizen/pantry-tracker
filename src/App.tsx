import React, { useState, useEffect, useCallback } from 'react';
import { LiveScanner } from './components/LiveScanner.tsx';
import { PhotoScanner } from './components/PhotoScanner.tsx';
import { ManualBarcodeInput } from './components/ManualBarcodeInput.tsx';
import { PantryModal } from './components/PantryModal.tsx';
import { initTelegramApp, triggerHaptic } from './telegram.ts';
import {
  fetchSession,
  joinPantry,
  updateWriteAccess,
  type SessionData,
  type ApiError,
  type Pantry,
} from './api.ts';
import { detectLanguage, t, type SupportedLanguage } from '@shared/i18n.ts';
import { parseStartParam } from '@shared/invites.ts';
import type { BarcodeDetection } from './barcodeReader.ts';

type ScanMode = 'live' | 'photo' | 'manual';

export const App: React.FC = () => {
  const [mode, setMode] = useState<ScanMode>('live');
  const [currentResult, setCurrentResult] = useState<BarcodeDetection | null>(null);
  const [history, setHistory] = useState<BarcodeDetection[]>([]);
  const [copied, setCopied] = useState(false);

  // Session state
  const [session, setSession] = useState<SessionData | null>(null);
  const [currentPantry, setCurrentPantry] = useState<Pantry | null>(null);
  const [pantries, setPantries] = useState<Pantry[]>([]);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<ApiError | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal state
  const [isPantryModalOpen, setIsPantryModalOpen] = useState(false);

  // Language state
  const tgUser = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.user : undefined;
  const [lang, setLang] = useState<SupportedLanguage>(() => detectLanguage(tgUser?.language_code));

  const loadSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError(null);

    const result = await fetchSession();
    if (result.error) {
      setSessionError(result.error);
    } else if (result.data) {
      setSession(result.data);
      setPantries(result.data.pantries);
      setCurrentPantry(result.data.currentPantry || result.data.pantries[0]);

      if (result.data.user.language_code) {
        setLang(detectLanguage(result.data.user.language_code));
      }

      // 1. Request write access for notifications if not granted yet
      if (!result.data.user.can_write_pm && typeof window !== 'undefined' && window.Telegram?.WebApp) {
        try {
          // @ts-expect-error Telegram WebApp method
          window.Telegram.WebApp.requestWriteAccess?.((granted: boolean) => {
            if (granted) {
              updateWriteAccess(true);
            }
          });
        } catch {
          // Ignore
        }
      }

      // 2. Check if launched via invite link start_param (e.g. join_<code>)
      const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
      const parsedInvite = parseStartParam(startParam);
      if (parsedInvite?.type === 'join') {
        const joinRes = await joinPantry(parsedInvite.code);
        if (joinRes.data) {
          setPantries(joinRes.data.pantries);
          setCurrentPantry(joinRes.data.pantry);
          setToastMessage(t(lang, 'invite_joined_toast'));
          triggerHaptic('success');
          setTimeout(() => setToastMessage(null), 4000);
        } else if (joinRes.error) {
          setToastMessage(joinRes.error.error);
          triggerHaptic('error');
          setTimeout(() => setToastMessage(null), 4000);
        }
      }
    }
    setSessionLoading(false);
  }, [lang]);

  useEffect(() => {
    initTelegramApp();
    loadSession();
  }, [loadSession]);

  const handleDetected = (detection: BarcodeDetection) => {
    setCurrentResult(detection);
    setHistory((prev) => [detection, ...prev.filter((d) => d.text !== detection.text)].slice(0, 8));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    triggerHaptic('light');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-tg-bg text-tg-text flex flex-col items-center px-4 py-3 sm:py-6 max-w-md mx-auto">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-3 left-4 right-4 z-50 p-3 bg-emerald-500 text-white rounded-xl shadow-lg text-xs font-semibold text-center animate-bounce-short">
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <header className="w-full flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-tg-text flex items-center gap-2">
            <span>📦 {t(lang, 'app_title')}</span>
          </h1>
          <p className="text-xs text-tg-hint">{t(lang, 'app_subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-semibold">
            Stage 2
          </span>
        </div>
      </header>

      {/* Pantry Bar / Switcher Button */}
      {currentPantry && (
        <div className="w-full mb-3 flex items-center justify-between p-2 bg-tg-secondary border border-tg-hint/15 rounded-xl text-xs">
          <button
            type="button"
            onClick={() => {
              setIsPantryModalOpen(true);
              triggerHaptic('light');
            }}
            className="flex items-center gap-2 font-semibold text-tg-text hover:opacity-80 transition"
          >
            <span className="text-base">{currentPantry.role === 'owner' ? '👑' : '👥'}</span>
            <div className="text-left">
              <div className="flex items-center gap-1">
                <span>{currentPantry.name}</span>
                <span className="text-[10px] text-tg-hint">▼</span>
              </div>
              <div className="text-[10px] text-tg-hint font-normal">
                {currentPantry.role === 'owner' ? t(lang, 'pantry_role_owner') : t(lang, 'pantry_role_member')}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsPantryModalOpen(true);
              triggerHaptic('light');
            }}
            className="px-2.5 py-1.5 bg-tg-button/15 text-tg-link rounded-lg font-semibold text-xs transition active:scale-95"
          >
            🔗 {t(lang, 'pantry_invite_btn')}
          </button>
        </div>
      )}

      {/* Session Loading State */}
      {sessionLoading && (
        <div className="w-full mb-3 p-3 bg-tg-secondary/70 border border-tg-hint/15 rounded-xl flex items-center justify-center gap-2 text-xs text-tg-hint">
          <div className="w-3.5 h-3.5 border-2 border-tg-link border-t-transparent rounded-full animate-spin" />
          <span>{t(lang, 'auth_checking')}</span>
        </div>
      )}

      {/* Session Error / Access Denied Banner */}
      {sessionError && !sessionLoading && (
        <div className="w-full mb-4 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-left text-xs">
          <div className="flex items-center gap-1.5 font-bold text-amber-500 mb-1">
            <span>⚠️</span>
            <span>{sessionError.code === 'NOT_ALLOWED' ? 'Доступ ограничен' : 'Авторизация'}</span>
          </div>
          <p className="text-tg-hint leading-relaxed">{sessionError.error}</p>

          {tgUser?.id && (
            <div className="mt-2 p-2 bg-black/10 dark:bg-white/5 rounded-lg font-mono text-[11px] text-tg-text">
              Ваш Telegram ID: <span className="font-bold select-all">{tgUser.id}</span>
            </div>
          )}

          <button
            type="button"
            onClick={loadSession}
            className="mt-2.5 px-3 py-1.5 bg-tg-button text-tg-button font-medium rounded-lg text-xs"
          >
            {t(lang, 'btn_retry')}
          </button>
        </div>
      )}

      {/* Mode Switcher Tabs */}
      <nav className="w-full grid grid-cols-3 gap-1 bg-tg-secondary p-1 rounded-xl mb-4 border border-tg-hint/15">
        <button
          type="button"
          onClick={() => {
            setMode('live');
            triggerHaptic('light');
          }}
          className={`py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
            mode === 'live'
              ? 'bg-tg-bg text-tg-text shadow-sm'
              : 'text-tg-hint hover:text-tg-text'
          }`}
        >
          <span>📹</span>
          <span>{t(lang, 'mode_live')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('photo');
            triggerHaptic('light');
          }}
          className={`py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
            mode === 'photo'
              ? 'bg-tg-bg text-tg-text shadow-sm'
              : 'text-tg-hint hover:text-tg-text'
          }`}
        >
          <span>📷</span>
          <span>{t(lang, 'mode_photo')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('manual');
            triggerHaptic('light');
          }}
          className={`py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
            mode === 'manual'
              ? 'bg-tg-bg text-tg-text shadow-sm'
              : 'text-tg-hint hover:text-tg-text'
          }`}
        >
          <span>⌨️</span>
          <span>{t(lang, 'mode_manual')}</span>
        </button>
      </nav>

      {/* Main Mode View */}
      <main className="w-full flex flex-col items-center">
        {mode === 'live' && (
          <LiveScanner
            onDetected={handleDetected}
            onSwitchToPhoto={() => setMode('photo')}
          />
        )}

        {mode === 'photo' && (
          <PhotoScanner
            onDetected={handleDetected}
            onSwitchToManual={() => setMode('manual')}
          />
        )}

        {mode === 'manual' && (
          <ManualBarcodeInput onDetected={handleDetected} />
        )}
      </main>

      {/* Current Scanned Result Card */}
      {currentResult && (
        <section className="w-full mt-4 bg-tg-secondary border border-tg-hint/25 rounded-2xl p-4 shadow-sm animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-tg-hint">
              {t(lang, 'scanner_scanned')}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-tg-button/15 text-tg-link font-semibold">
                {currentResult.format}
              </span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                  currentResult.isValidEan
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-red-500/15 text-red-500'
                }`}
              >
                {currentResult.isValidEan ? 'EAN OK' : 'Не EAN'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 mt-1">
            <span className="font-mono text-xl sm:text-2xl font-bold tracking-widest text-tg-text select-all">
              {currentResult.text}
            </span>

            <button
              type="button"
              onClick={() => copyToClipboard(currentResult.text)}
              className="px-3 py-1.5 bg-tg-bg border border-tg-hint/20 hover:border-tg-hint/40 rounded-xl text-xs font-medium text-tg-text transition active:scale-95"
            >
              {copied ? ` ${t(lang, 'copied')}` : `📋 ${t(lang, 'btn_copy')}`}
            </button>
          </div>

          {currentResult.isValidEan ? (
            <p className="text-[12px] text-emerald-500 mt-2 flex items-center gap-1 font-medium">
              <span>✅</span>
              <span>{t(lang, 'ean_valid')}</span>
            </p>
          ) : (
            <p className="text-[12px] text-amber-500 mt-2 flex items-center gap-1">
              <span>⚠️</span>
              <span>{t(lang, 'ean_invalid')}</span>
            </p>
          )}
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section className="w-full mt-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold text-tg-hint uppercase tracking-wider">
              {t(lang, 'history_title')} ({history.length})
            </span>
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-[11px] text-tg-hint hover:text-tg-destructive transition"
            >
              {t(lang, 'history_clear')}
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            {history.map((item) => (
              <div
                key={`${item.text}-${item.timestamp}`}
                onClick={() => setCurrentResult(item)}
                className="flex items-center justify-between p-2.5 bg-tg-secondary/70 hover:bg-tg-secondary border border-tg-hint/15 rounded-xl cursor-pointer transition text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm tracking-wider text-tg-text">
                    {item.text}
                  </span>
                  <span className="text-[10px] text-tg-hint font-medium">
                    ({item.format})
                  </span>
                </div>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    item.isValidEan
                      ? 'text-emerald-500 bg-emerald-500/10'
                      : 'text-amber-500 bg-amber-500/10'
                  }`}
                >
                  {item.isValidEan ? '✓ EAN' : '!'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pantry Management Modal */}
      {currentPantry && session && (
        <PantryModal
          isOpen={isPantryModalOpen}
          onClose={() => setIsPantryModalOpen(false)}
          pantries={pantries}
          currentPantry={currentPantry}
          currentUserId={session.user.telegram_id}
          lang={lang}
          onSelectPantry={(p) => setCurrentPantry(p)}
          onUpdatePantries={(updatedPantries, newActive) => {
            setPantries(updatedPantries);
            if (newActive) setCurrentPantry(newActive);
          }}
        />
      )}
    </div>
  );
};
export default App;
