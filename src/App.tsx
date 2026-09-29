import React, { useState, useEffect } from 'react';
import { LiveScanner } from './components/LiveScanner.tsx';
import { PhotoScanner } from './components/PhotoScanner.tsx';
import { ManualBarcodeInput } from './components/ManualBarcodeInput.tsx';
import { initTelegramApp, triggerHaptic } from './telegram.ts';
import type { BarcodeDetection } from './barcodeReader.ts';

type ScanMode = 'live' | 'photo' | 'manual';

export const App: React.FC = () => {
  const [mode, setMode] = useState<ScanMode>('live');
  const [currentResult, setCurrentResult] = useState<BarcodeDetection | null>(null);
  const [history, setHistory] = useState<BarcodeDetection[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    initTelegramApp();
  }, []);

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
      {/* Header */}
      <header className="w-full flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-tg-text flex items-center gap-2">
            <span>📦 Pantry Tracker</span>
          </h1>
          <p className="text-xs text-tg-hint">Этап 0: Проверка камеры и сканера</p>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-semibold">
          Stage 0
        </span>
      </header>

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
          <span>Камера</span>
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
          <span>Фото</span>
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
          <span>Вручную</span>
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
              Результат распознавания
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
              {copied ? ' Скопировано!' : '📋 Копировать'}
            </button>
          </div>

          {currentResult.isValidEan ? (
            <p className="text-[12px] text-emerald-500 mt-2 flex items-center gap-1 font-medium">
              <span>✅</span>
              <span>Контрольная сумма верна по стандарту GS1</span>
            </p>
          ) : (
            <p className="text-[12px] text-amber-500 mt-2 flex items-center gap-1">
              <span>⚠️</span>
              <span>Штрихкод считан, но не является стандартным EAN-13/EAN-8</span>
            </p>
          )}
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section className="w-full mt-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold text-tg-hint uppercase tracking-wider">
              История сканирований ({history.length})
            </span>
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-[11px] text-tg-hint hover:text-tg-destructive transition"
            >
              Очистить
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

      {/* Testing checklist card for Human Acceptance */}
      <section className="w-full mt-6 bg-tg-secondary/50 border border-tg-hint/15 rounded-2xl p-4 text-xs text-tg-hint">
        <h2 className="font-bold text-tg-text text-sm mb-2 flex items-center gap-1.5">
          <span>📋</span>
          <span>Чек-лист проверки этапа 0:</span>
        </h2>
        <ul className="space-y-1.5 list-disc list-inside">
          <li>Камера запускается без чёрного экрана на iOS</li>
          <li>Разрешение запрашивается и запоминается</li>
          <li>Штрихкод EAN-13 мгновенно считывается живым потоком</li>
          <li>Запасной режим фото работает при съёмке камерой</li>
          <li>Ручной ввод подсвечивает корректность контрольной цифры</li>
          <li>Тема Telegram (светлая/тёмная) подхватывается автоматически</li>
        </ul>
      </section>
    </div>
  );
};
export default App;
