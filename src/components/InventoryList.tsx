import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  type PantryItem,
  type ItemPreviousState,
  getPantryItems,
  consumeItem,
  restoreItem,
} from '../api.ts';
import { t, type SupportedLanguage } from '@shared/i18n.ts';
import { getItemFreshness, sortItemsByFifo } from '@shared/inventory.ts';
import { triggerHaptic } from '../telegram.ts';

interface InventoryListProps {
  pantryId: string;
  pantryName: string;
  lang: SupportedLanguage;
  onOpenScanner: () => void;
}

interface UndoState {
  item: PantryItem;
  previousState: ItemPreviousState;
  action: 'consumed' | 'discarded';
}

export const InventoryList: React.FC<InventoryListProps> = ({
  pantryId,
  pantryName,
  lang,
  onOpenScanner,
}) => {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(5);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const res = await getPantryItems(pantryId, 'active');
    setLoading(false);
    if (res.data?.items) {
      setItems(sortItemsByFifo(res.data.items));
    }
  }, [pantryId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Countdown timer for Undo
  useEffect(() => {
    if (!undoState) return;

    setUndoSeconds(5);
    const interval = setInterval(() => {
      setUndoSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setUndoState(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [undoState]);

  const handleAction = async (item: PantryItem, action: 'consumed' | 'discarded') => {
    setActionInProgressId(item.id);
    triggerHaptic('heavy');

    const res = await consumeItem(pantryId, item.id, action);
    setActionInProgressId(null);

    if (res.error) {
      triggerHaptic('error');
      alert(res.error.error || 'Ошибка списания товара');
      return;
    }

    if (res.data) {
      // Update local state immediately for snappy feel
      if (res.data.item.status !== 'active') {
        // Closed completely -> remove from active list
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      } else {
        // Quantity decreased -> update quantity in list
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, quantity: res.data!.item.quantity } : i))
        );
      }

      setUndoState({
        item,
        previousState: res.data.previousState,
        action,
      });
      triggerHaptic('light');
    }
  };

  const handleUndo = async () => {
    if (!undoState) return;

    const { item, previousState } = undoState;
    triggerHaptic('heavy');
    setUndoState(null);

    const res = await restoreItem(pantryId, item.id, previousState);
    if (res.error) {
      triggerHaptic('error');
      alert(res.error.error || 'Ошибка отмены списания');
      return;
    }

    if (res.data?.item) {
      triggerHaptic('success');
      loadItems();
    }
  };

  const formatDate = (isoStr: string) => {
    try {
      const parts = isoStr.split('-');
      if (parts.length === 3) {
        const d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
        return d.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-US' : 'ru-RU', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        });
      }
    } catch {
      // Fallback
    }
    return isoStr;
  };

  // Filter and statistics
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      (item) => item.name.toLowerCase().includes(q) || (item.barcode && item.barcode.includes(q))
    );
  }, [items, searchQuery]);

  const stats = useMemo(() => {
    const now = new Date();
    let expiredCount = 0;
    let warningCount = 0;
    let freshCount = 0;

    for (const item of items) {
      const f = getItemFreshness(item.expiration_date, now);
      if (f.status === 'expired') expiredCount += item.quantity;
      else if (f.status === 'warning') warningCount += item.quantity;
      else freshCount += item.quantity;
    }

    return { expiredCount, warningCount, freshCount, totalQty: expiredCount + warningCount + freshCount };
  }, [items]);

  return (
    <div className="w-full space-y-3 pb-24">
      {/* Title */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-tg-text flex items-center gap-1.5">
          <span>📦</span>
          <span>{pantryName}: {t(lang, 'inventory_title')}</span>
        </h2>
      </div>

      {/* Search Bar & Stats */}
      <div className="space-y-2">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(lang, 'inventory_search_placeholder')}
            className="w-full pl-9 pr-8 py-2.5 rounded-2xl bg-tg-secondary border border-tg-hint/20 text-tg-text text-xs placeholder:text-tg-hint/60 focus:outline-none focus:ring-2 focus:ring-tg-button transition"
          />
          <span className="absolute left-3 top-2.5 text-xs text-tg-hint">🔍</span>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-2.5 text-xs text-tg-hint hover:text-tg-text"
            >
              ✕
            </button>
          )}
        </div>

        {/* Freshness Stats Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 text-[11px] font-semibold">
          <span className="px-2.5 py-1 rounded-xl bg-tg-secondary border border-tg-hint/15 text-tg-text whitespace-nowrap">
            📦 {items.length} {t(lang, 'inventory_count_items')} ({stats.totalQty} шт.)
          </span>
          {stats.expiredCount > 0 && (
            <span className="px-2.5 py-1 rounded-xl bg-red-500/15 border border-red-500/25 text-red-500 whitespace-nowrap font-bold">
              🔴 {stats.expiredCount} просрочено
            </span>
          )}
          {stats.warningCount > 0 && (
            <span className="px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-500 whitespace-nowrap font-bold">
              🟡 {stats.warningCount} ≤ 3 дн.
            </span>
          )}
          {stats.freshCount > 0 && (
            <span className="px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-500 whitespace-nowrap font-bold">
              🟢 {stats.freshCount} свежих
            </span>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="py-12 flex flex-col items-center justify-center text-tg-hint gap-3">
          <div className="w-8 h-8 border-3 border-tg-button border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-medium">Загрузка запасов склада...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && items.length === 0 && (
        <div className="py-12 px-4 rounded-3xl bg-tg-secondary/60 border border-tg-hint/15 text-center flex flex-col items-center gap-3">
          <span className="text-4xl">🧺</span>
          <div className="space-y-1">
            <h3 className="font-bold text-sm text-tg-text">{t(lang, 'inventory_empty')}</h3>
            <p className="text-xs text-tg-hint max-w-xs">{t(lang, 'inventory_scan_first')}</p>
          </div>
          <button
            type="button"
            onClick={onOpenScanner}
            className="mt-2 py-2.5 px-5 rounded-xl bg-tg-button text-tg-button text-xs font-bold shadow-md active:scale-95 transition flex items-center gap-2"
          >
            <span>📷</span>
            <span>{t(lang, 'tab_scan')}</span>
          </button>
        </div>
      )}

      {/* Filtered empty state */}
      {!loading && items.length > 0 && filteredItems.length === 0 && (
        <div className="py-8 text-center text-tg-hint text-xs">
          Ничего не найдено по запросу «{searchQuery}»
        </div>
      )}

      {/* Items List */}
      {!loading && filteredItems.length > 0 && (
        <div className="space-y-2">
          {filteredItems.map((item, idx) => {
            const freshness = getItemFreshness(item.expiration_date, new Date());
            const isProcessing = actionInProgressId === item.id;
            const isFirst = idx === 0;

            let badgeClass = 'bg-emerald-500/15 text-emerald-500 border-emerald-500/25';
            let statusText = `Годен до: ${formatDate(item.expiration_date)}`;

            if (freshness.status === 'expired') {
              badgeClass = 'bg-red-500/15 text-red-500 border-red-500/25';
              statusText = `${t(lang, 'freshness_expired')} (${Math.abs(freshness.daysRemaining)} дн.)`;
            } else if (freshness.status === 'warning') {
              badgeClass = 'bg-amber-500/15 text-amber-500 border-amber-500/25';
              statusText =
                freshness.daysRemaining === 0
                  ? t(lang, 'freshness_today')
                  : `${freshness.daysRemaining} ${t(lang, 'freshness_days_left')}`;
            }

            return (
              <div
                key={item.id}
                className="p-3.5 rounded-2xl bg-tg-secondary border border-tg-hint/15 shadow-xs space-y-2.5 transition"
              >
                {/* Top line: Name, Barcode & Quantity */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-tg-text leading-tight">{item.name}</span>
                      {isFirst && items.length > 1 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-tg-button/20 text-tg-button border border-tg-button/30">
                          FIFO #1
                        </span>
                      )}
                    </div>
                    {item.barcode && (
                      <div className="font-mono text-[10px] text-tg-hint flex items-center gap-1">
                        <span>🏷️</span>
                        <span>{item.barcode}</span>
                      </div>
                    )}
                  </div>

                  <span className="px-2.5 py-1 rounded-xl bg-tg-bg border border-tg-hint/20 font-bold text-xs text-tg-text shrink-0">
                    {item.quantity} шт.
                  </span>
                </div>

                {/* Bottom line: Expiration Badge and Action buttons */}
                <div className="flex items-center justify-between pt-1 border-t border-tg-hint/10 gap-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass} truncate`}>
                    📅 {statusText}
                  </span>

                  {/* Actions: Primary "Списать" + Compact "🗑️" icon */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleAction(item, 'consumed')}
                      className="py-1 px-3 rounded-xl bg-tg-button text-tg-button hover:opacity-90 text-[11px] font-bold transition active:scale-95 disabled:opacity-50 flex items-center gap-1 shadow-2xs"
                      title={t(lang, 'item_action_consume')}
                    >
                      <span>🍽️</span>
                      <span>{t(lang, 'item_action_consume')}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleAction(item, 'discarded')}
                      className="py-1 px-2 rounded-xl bg-tg-bg hover:bg-red-500/15 border border-tg-hint/20 hover:border-red-500/30 text-tg-hint hover:text-red-500 text-[12px] transition active:scale-95 disabled:opacity-50 flex items-center justify-center"
                      title={t(lang, 'item_action_discard')}
                      aria-label={t(lang, 'item_action_discard')}
                    >
                      <span>🗑️</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Undo Banner */}
      {undoState && (
        <div className="fixed bottom-4 left-4 right-4 z-50 p-3 bg-zinc-900 text-white rounded-2xl shadow-2xl border border-zinc-700 flex items-center justify-between gap-3 animate-slide-up">
          <div className="text-xs truncate">
            <span className="font-semibold">
              {undoState.action === 'consumed' ? '🍽️ Списано:' : '🗑️ Выброшено:'}
            </span>{' '}
            <span>{undoState.item.name}</span>
          </div>

          <button
            type="button"
            onClick={handleUndo}
            className="py-1.5 px-3 rounded-xl bg-amber-500 text-black font-bold text-xs shrink-0 active:scale-95 transition shadow-sm flex items-center gap-1"
          >
            <span>↩️</span>
            <span>{t(lang, 'item_undo')} ({undoSeconds}с)</span>
          </button>
        </div>
      )}
    </div>
  );
};
