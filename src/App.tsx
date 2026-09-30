import React, { useState, useEffect, useCallback } from 'react';
import { LiveScanner } from './components/LiveScanner.tsx';
import { PhotoScanner } from './components/PhotoScanner.tsx';
import { ManualBarcodeInput } from './components/ManualBarcodeInput.tsx';
import { PantryModal } from './components/PantryModal.tsx';
import { ProductCardModal } from './components/ProductCardModal.tsx';
import { InventoryList } from './components/InventoryList.tsx';
import { FifoBatchPickerModal } from './components/FifoBatchPickerModal.tsx';
import { UserSettingsModal } from './components/UserSettingsModal.tsx';
import { OcrDateScannerModal } from './components/OcrDateScannerModal.tsx';
import { initTelegramApp, triggerHaptic } from './telegram.ts';
import {
  fetchSession,
  joinPantry,
  updateWriteAccess,
  consumeBarcodeFifo,
  type SessionData,
  type ApiError,
  type Pantry,
  type PantryItem,
} from './api.ts';
import { detectLanguage, t, type SupportedLanguage } from '@shared/i18n.ts';
import { parseStartParam } from '@shared/invites.ts';
import type { BarcodeDetection } from './barcodeReader.ts';

type ActiveSection = 'inventory' | 'scanner';
type ScanMode = 'live' | 'photo' | 'manual';
type ScannerAction = 'add' | 'consume';

export const App: React.FC = () => {
  const [activeSection, setActiveSection] = useState<ActiveSection>('inventory');
  const [scannerMode, setScannerMode] = useState<ScannerAction>('add');
  const [scanType, setScanType] = useState<ScanMode>('live');

  const [currentResult, setCurrentResult] = useState<BarcodeDetection | null>(null);
  const [history, setHistory] = useState<BarcodeDetection[]>([]);
  const [copied, setCopied] = useState(false);

  // Stage 3 & 4 Product card modal state
  const [selectedProductBarcode, setSelectedProductBarcode] = useState<string | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);

  // Stage 5 FIFO batch picker modal state
  const [fifoBatches, setFifoBatches] = useState<PantryItem[]>([]);
  const [fifoBarcode, setFifoBarcode] = useState<string>('');
  const [isFifoModalOpen, setIsFifoModalOpen] = useState(false);
  const [inventoryRefreshKey, setInventoryRefreshKey] = useState(0);

  // Session state
  const [session, setSession] = useState<SessionData | null>(null);
  const [currentPantry, setCurrentPantry] = useState<Pantry | null>(null);
  const [pantries, setPantries] = useState<Pantry[]>([]);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<ApiError | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal state
  const [isPantryModalOpen, setIsPantryModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isMainOcrOpen, setIsMainOcrOpen] = useState(false);
  const [prefilledOcrDate, setPrefilledOcrDate] = useState<string | null>(null);

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

      // 1. Request Telegram PM write access if not granted
      const tgWebApp = typeof window !== 'undefined' ? (window.Telegram?.WebApp as unknown as { requestWriteAccess?: (cb: (allowed: boolean) => void) => void }) : undefined;
      if (!result.data.user.can_write_pm && tgWebApp?.requestWriteAccess) {
        try {
          tgWebApp.requestWriteAccess((allowed: boolean) => {
            if (allowed) {
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

  const handleDetected = async (detection: BarcodeDetection) => {
    setCurrentResult(detection);
    setHistory((prev) => [detection, ...prev.filter((d) => d.text !== detection.text)].slice(0, 8));

    if (scannerMode === 'add') {
      setSelectedProductBarcode(detection.text);
      setIsProductModalOpen(true);
    } else {
      // Consume mode: check FIFO
      if (!currentPantry) {
        setToastMessage(t(lang, 'item_no_pantry'));
        triggerHaptic('error');
        setTimeout(() => setToastMessage(null), 3000);
        return;
      }

      const res = await consumeBarcodeFifo(currentPantry.id, detection.text);
      if (!res.data?.found) {
        setToastMessage(t(lang, 'fifo_not_found'));
        triggerHaptic('error');
        setTimeout(() => setToastMessage(null), 3500);
        return;
      }

      if (res.data.multipleBatches && res.data.items && res.data.items.length > 0) {
        setFifoBatches(res.data.items);
        setFifoBarcode(detection.text);
        setIsFifoModalOpen(true);
        triggerHaptic('heavy');
      } else if (res.data.item) {
        triggerHaptic('success');
        setToastMessage(`✓ «${res.data.item.name}» списан (-1 шт.)!`);
        setTimeout(() => setToastMessage(null), 3500);
        setInventoryRefreshKey((k) => k + 1);
      }
    }
  };

  const handleSelectFifoBatch = async (batch: PantryItem) => {
    if (!currentPantry) return;
    setIsFifoModalOpen(false);

    const res = await consumeBarcodeFifo(currentPantry.id, fifoBarcode, {
      itemId: batch.id,
    });

    if (res.data?.item) {
      triggerHaptic('success');
      setToastMessage(`✓ «${res.data.item.name}» списан (-1 шт.)!`);
      setTimeout(() => setToastMessage(null), 3500);
      setInventoryRefreshKey((k) => k + 1);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    triggerHaptic('light');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-tg-bg text-tg-text flex flex-col items-center px-4 safe-area-top-padding safe-area-bottom-padding max-w-md mx-auto">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed safe-area-toast-top left-4 right-4 z-50 p-3 bg-emerald-500 text-white rounded-2xl shadow-lg text-xs font-semibold text-center animate-bounce-short">
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
          <button
            type="button"
            onClick={() => {
              setIsSettingsModalOpen(true);
              triggerHaptic('light');
            }}
            className="w-8 h-8 rounded-full bg-tg-secondary border border-tg-hint/20 flex items-center justify-center text-sm hover:opacity-80 active:scale-95 transition"
            title={t(lang, 'settings_title')}
          >
            ⚙️
          </button>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-semibold">
            v1.0 • Ready
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
            className="flex items-center gap-2 font-semibold text-tg-text hover:opacity-80 transition text-left"
          >
            <span className="text-base">{currentPantry.role === 'owner' ? '👑' : '👥'}</span>
            <div>
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
            <span>{sessionError.code === 'NOT_ALLOWED' ? t(lang, 'access_restricted') : t(lang, 'auth_title')}</span>
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

      {/* Stage 5: Primary Navigation Tabs (📦 Склад vs 📷 Сканер) */}
      <nav className="w-full grid grid-cols-2 gap-1.5 p-1 bg-tg-secondary rounded-2xl mb-3 border border-tg-hint/15">
        <button
          type="button"
          onClick={() => {
            setActiveSection('inventory');
            triggerHaptic('light');
          }}
          className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
            activeSection === 'inventory'
              ? 'bg-tg-button text-tg-button shadow-sm'
              : 'text-tg-hint hover:text-tg-text'
          }`}
        >
          <span>📦</span>
          <span>{t(lang, 'tab_inventory')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSection('scanner');
            triggerHaptic('light');
          }}
          className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
            activeSection === 'scanner'
              ? 'bg-tg-button text-tg-button shadow-sm'
              : 'text-tg-hint hover:text-tg-text'
          }`}
        >
          <span>📷</span>
          <span>{t(lang, 'tab_scan')}</span>
        </button>
      </nav>

      {/* SECTION 1: INVENTORY LIST VIEW */}
      {activeSection === 'inventory' && currentPantry && (
        <InventoryList
          key={`${currentPantry.id}-${inventoryRefreshKey}`}
          pantryId={currentPantry.id}
          pantryName={currentPantry.name}
          lang={lang}
          onOpenScanner={() => setActiveSection('scanner')}
        />
      )}

      {activeSection === 'inventory' && !currentPantry && !sessionLoading && (
        <div className="w-full p-6 bg-tg-secondary border border-tg-hint/20 rounded-2xl text-center space-y-3">
          <div className="text-4xl">📦</div>
          <h2 className="font-bold text-sm text-tg-text">{t(lang, 'pantry_create_title')}</h2>
          <p className="text-xs text-tg-hint">{t(lang, 'item_no_pantry')}</p>
          <button
            type="button"
            onClick={() => {
              setIsPantryModalOpen(true);
              triggerHaptic('light');
            }}
            className="py-2.5 px-4 bg-tg-button text-tg-button font-bold text-xs rounded-xl shadow-sm active:scale-95 transition"
          >
            ➕ {t(lang, 'pantry_create_btn')}
          </button>
        </div>
      )}

      {/* SECTION 2: SCANNER VIEW */}
      {activeSection === 'scanner' && (
        <div className="w-full space-y-3">
          {/* Scanner Mode Toggle: [+ Приход] vs [− Списание] */}
          <div className="w-full flex items-center justify-between p-1.5 bg-tg-secondary rounded-2xl border border-tg-hint/15">
            <span className="text-[11px] font-semibold text-tg-hint pl-2">{t(lang, 'action_menu')}</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setScannerMode('add');
                  triggerHaptic('light');
                }}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                  scannerMode === 'add'
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'text-tg-hint hover:text-tg-text'
                }`}
              >
                <span>➕</span>
                <span>{t(lang, 'scan_mode_add')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setScannerMode('consume');
                  triggerHaptic('light');
                }}
                className={`py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                  scannerMode === 'consume'
                    ? 'bg-amber-500 text-black shadow-xs'
                    : 'text-tg-hint hover:text-tg-text'
                }`}
              >
                <span>➖</span>
                <span>{t(lang, 'scan_mode_consume')}</span>
              </button>
            </div>
          </div>

          {/* Scanner Input Sub-mode: Live / Photo / Manual / OCR */}
          <nav className="w-full grid grid-cols-4 gap-1 bg-tg-secondary p-1 rounded-xl border border-tg-hint/15">
            <button
              type="button"
              onClick={() => {
                setScanType('live');
                triggerHaptic('light');
              }}
              className={`py-1.5 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1 ${
                scanType === 'live'
                  ? 'bg-tg-bg text-tg-text shadow-xs'
                  : 'text-tg-hint hover:text-tg-text'
              }`}
            >
              <span>📹</span>
              <span>{t(lang, 'mode_live')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScanType('photo');
                triggerHaptic('light');
              }}
              className={`py-1.5 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1 ${
                scanType === 'photo'
                  ? 'bg-tg-bg text-tg-text shadow-xs'
                  : 'text-tg-hint hover:text-tg-text'
              }`}
            >
              <span>📷</span>
              <span>{t(lang, 'mode_photo')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScanType('manual');
                triggerHaptic('light');
              }}
              className={`py-1.5 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1 ${
                scanType === 'manual'
                  ? 'bg-tg-bg text-tg-text shadow-xs'
                  : 'text-tg-hint hover:text-tg-text'
              }`}
            >
              <span>⌨️</span>
              <span>{t(lang, 'mode_manual')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsMainOcrOpen(true);
                triggerHaptic('light');
              }}
              className="py-1.5 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-95 border border-emerald-500/25"
              title={t(lang, 'ocr_scan_btn')}
            >
              <span>🔍</span>
              <span>OCR</span>
            </button>
          </nav>

          {/* Scanner active mode container */}
          <main className="w-full">
            {scanType === 'live' && (
              <LiveScanner
                onDetected={handleDetected}
                onSwitchToPhoto={() => setScanType('photo')}
              />
            )}
            {scanType === 'photo' && (
              <PhotoScanner
                lang={lang}
                onDetected={handleDetected}
                onSwitchToManual={() => setScanType('manual')}
              />
            )}
            {scanType === 'manual' && (
              <ManualBarcodeInput lang={lang} onDetected={handleDetected} />
            )}
          </main>

          {/* Current result badge */}
          {currentResult && (
            <div className="w-full p-3.5 rounded-2xl bg-tg-secondary border border-tg-hint/20 text-xs space-y-1.5 animate-slide-up">
              <div className="flex items-center justify-between">
                <span className="font-bold text-tg-text flex items-center gap-1.5">
                  <span>{currentResult.isValidEan ? '✅' : 'ℹ️'}</span>
                  <span>{currentResult.isValidEan ? 'EAN OK' : t(lang, 'mode_manual')}</span>
                </span>
                <span className="font-mono text-xs font-bold text-tg-button">{currentResult.text}</span>
              </div>
              <p className="text-[11px] text-tg-hint">
                {currentResult.isValidEan
                  ? t(lang, 'ean_valid')
                  : t(lang, 'ean_invalid')}
              </p>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <section className="w-full pt-1 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-tg-hint">
                <span className="font-semibold">{t(lang, 'history_title')}</span>
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="hover:underline"
                >
                  {t(lang, 'history_clear')}
                </button>
              </div>

              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((item, index) => (
                  <div
                    key={`${item.text}-${index}`}
                    onClick={() => copyToClipboard(item.text)}
                    className="p-2 rounded-xl bg-tg-secondary/70 border border-tg-hint/15 flex items-center justify-between text-xs cursor-pointer hover:bg-tg-secondary transition active:scale-98"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-tg-text font-medium">{item.text}</span>
                      <span className="text-[10px] text-tg-hint">
                        {copied ? t(lang, 'copied') : item.format || 'EAN'}
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
        </div>
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
          onSelectPantry={(p) => {
            setCurrentPantry(p);
            setInventoryRefreshKey((k) => k + 1);
          }}
          onUpdatePantries={(updatedPantries, newActive) => {
            setPantries(updatedPantries);
            if (newActive) setCurrentPantry(newActive);
            setInventoryRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* Stage 4 Product Card / Add Modal */}
      {selectedProductBarcode && (
        <ProductCardModal
          isOpen={isProductModalOpen}
          barcode={selectedProductBarcode}
          format={currentResult?.format}
          lang={lang}
          currentPantryId={currentPantry?.id}
          initialExpirationDate={prefilledOcrDate || undefined}
          onClose={() => {
            setIsProductModalOpen(false);
            setPrefilledOcrDate(null);
          }}
          onItemAdded={(item) => {
            setToastMessage(`✓ «${item.name}» (${item.quantity} шт.) добавлен на склад (до ${item.expiration_date})!`);
            triggerHaptic('success');
            setPrefilledOcrDate(null);
            setTimeout(() => setToastMessage(null), 3500);
            setInventoryRefreshKey((k) => k + 1);
          }}
          onProductConfirmed={(p) => {
            setToastMessage(`✓ Товар «${p.name}» (${p.quantity} шт.) подтвержден!`);
            setPrefilledOcrDate(null);
            setTimeout(() => setToastMessage(null), 3500);
          }}
        />
      )}

      {/* Stage 5 FIFO Batch Picker Modal */}
      <FifoBatchPickerModal
        isOpen={isFifoModalOpen}
        barcode={fifoBarcode}
        items={fifoBatches}
        lang={lang}
        onClose={() => setIsFifoModalOpen(false)}
        onSelectBatch={handleSelectFifoBatch}
      />

      {/* Stage 6 User Settings Modal */}
      {session?.user && (
        <UserSettingsModal
          isOpen={isSettingsModalOpen}
          user={session.user}
          lang={lang}
          onClose={() => setIsSettingsModalOpen(false)}
          onUserUpdated={(updatedUser) => {
            setSession((prev) => (prev ? { ...prev, user: updatedUser } : null));
            setToastMessage(`✓ ${t(lang, 'settings_saved')}`);
            setTimeout(() => setToastMessage(null), 3000);
          }}
        />
      )}

      {/* Stage 8 Standalone OCR Scanner Modal */}
      <OcrDateScannerModal
        isOpen={isMainOcrOpen}
        lang={lang}
        onClose={() => setIsMainOcrOpen(false)}
        onDateSelected={(dateIso) => {
          setPrefilledOcrDate(dateIso);
          setToastMessage(`✓ Срок годности ${dateIso} сохранён. Теперь отсканируйте товар!`);
          triggerHaptic('success');
          setTimeout(() => setToastMessage(null), 4000);
        }}
      />
    </div>
  );
};
export default App;
