import React from 'react';
import type { PantryItem } from '../api.ts';
import { t, type SupportedLanguage } from '@shared/i18n.ts';
import { getItemFreshness } from '@shared/inventory.ts';
import { triggerHaptic } from '../telegram.ts';

interface FifoBatchPickerModalProps {
  isOpen: boolean;
  barcode: string;
  items: PantryItem[];
  lang: SupportedLanguage;
  onClose: () => void;
  onSelectBatch: (item: PantryItem) => void;
}

export const FifoBatchPickerModal: React.FC<FifoBatchPickerModalProps> = ({
  isOpen,
  barcode,
  items,
  lang,
  onClose,
  onSelectBatch,
}) => {
  if (!isOpen || items.length === 0) return null;

  const productName = items[0]?.name || barcode;

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

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-tg-bg text-tg-text rounded-t-3xl sm:rounded-2xl border border-tg-hint/20 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-slide-up">
        {/* Header */}
        <div className="p-4 border-b border-tg-hint/15 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚖️</span>
            <div>
              <h3 className="font-bold text-sm text-tg-text">{t(lang, 'fifo_modal_title')}</h3>
              <p className="text-[11px] text-tg-hint truncate max-w-[220px]">
                {productName}
              </p>
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

        {/* Batches list */}
        <div className="p-4 space-y-2.5 overflow-y-auto">
          <p className="text-xs text-tg-hint mb-1">
            {t(lang, 'fifo_picker_prompt')}
          </p>

          {items.map((item, index) => {
            const freshness = getItemFreshness(item.expiration_date, new Date());
            const isEarliest = index === 0;

            let badgeColor = 'bg-emerald-500/15 text-emerald-500 border-emerald-500/25';
            let statusText = `${freshness.daysRemaining} ${t(lang, 'freshness_days_left')}`;

            if (freshness.status === 'expired') {
              badgeColor = 'bg-red-500/15 text-red-500 border-red-500/25';
              statusText = `${t(lang, 'freshness_expired')} (${Math.abs(freshness.daysRemaining)} ${t(lang, 'days_short')})`;
            } else if (freshness.status === 'warning') {
              badgeColor = 'bg-amber-500/15 text-amber-500 border-amber-500/25';
              statusText = freshness.daysRemaining === 0 ? t(lang, 'freshness_today') : `${freshness.daysRemaining} ${t(lang, 'days_short')}`;
            }

            return (
              <div
                key={item.id}
                className={`p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${
                  isEarliest
                    ? 'bg-tg-secondary border-tg-button shadow-xs'
                    : 'bg-tg-bg border-tg-hint/15 hover:border-tg-hint/30'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-tg-text">
                      📅 {formatDate(item.expiration_date)}
                    </span>
                    {isEarliest && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-tg-button text-tg-button shadow-xs">
                        ⭐ {t(lang, 'fifo_recommended')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-tg-hint">
                    <span>{t(lang, 'batch_remaining').replace('{qty}', String(item.quantity))}</span>
                    <span>•</span>
                    <span className={`px-1.5 py-0.2 rounded border text-[10px] font-semibold ${badgeColor}`}>
                      {statusText}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('heavy');
                    onSelectBatch(item);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition shrink-0 active:scale-95 ${
                    isEarliest
                      ? 'bg-tg-button text-tg-button shadow-xs'
                      : 'bg-tg-secondary text-tg-text border border-tg-hint/20 hover:bg-tg-button hover:text-tg-button'
                  }`}
                >
                  {t(lang, 'fifo_confirm_btn')}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-tg-hint/15">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl bg-tg-secondary text-tg-text text-xs font-semibold"
          >
            {t(lang, 'btn_cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
