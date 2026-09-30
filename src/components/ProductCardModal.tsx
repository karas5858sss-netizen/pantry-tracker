import React, { useState, useEffect, useRef, useMemo } from 'react';
import { type ProductInfo, type PantryItem, lookupProduct, saveProduct, createItem } from '../api.ts';
import { t, type SupportedLanguage } from '@shared/i18n.ts';
import { triggerHaptic } from '../telegram.ts';
import {
  getExpirationPresets,
  parseMonthYearExpiration,
  validateExpirationDate,
  addDays,
} from '@shared/expiration.ts';
import { OcrDateScannerModal } from './OcrDateScannerModal.tsx';

interface ProductCardModalProps {
  isOpen: boolean;
  barcode?: string | null;
  format?: string;
  lang: SupportedLanguage;
  currentPantryId?: string;
  initialExpirationDate?: string;
  onClose: () => void;
  onProductConfirmed?: (product: { barcode?: string | null; name: string; quantity: number; expirationDate: string }) => void;
  onItemAdded?: (item: PantryItem) => void;
}

export const ProductCardModal: React.FC<ProductCardModalProps> = ({
  isOpen,
  barcode,
  format,
  lang,
  currentPantryId,
  initialExpirationDate,
  onClose,
  onProductConfirmed,
  onItemAdded,
}) => {
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [productName, setProductName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Expiration date state
  const [dateMode, setDateMode] = useState<'exact' | 'monthYear'>('exact');
  const [expirationDate, setExpirationDate] = useState<string>('');
  const [monthYearInput, setMonthYearInput] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [isOcrOpen, setIsOcrOpen] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Calculate presets dynamically based on today
  const presets = useMemo(() => {
    return getExpirationPresets(new Date());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setProduct(null);
    setProductName('');
    setIsEditingName(!barcode);
    setQuantity(1);
    setErrorMsg(null);
    setDateMode('exact');
    setMonthYearInput('');

    // Default expiration date: passed initial date or +7 days
    if (initialExpirationDate) {
      setExpirationDate(initialExpirationDate);
      setSelectedPreset(null);
    } else {
      const defaultDate = addDays(new Date(), 7);
      setExpirationDate(defaultDate);
      setSelectedPreset('7d');
    }

    if (!barcode) {
      setLoading(false);
      setIsEditingName(true);
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 150);
      return;
    }

    setLoading(true);
    lookupProduct(barcode, lang).then((res) => {
      setLoading(false);
      if (res.found && res.product) {
        setProduct(res.product);
        setProductName(res.product.name);
        triggerHaptic('success');
      } else {
        triggerHaptic('error');
        setIsEditingName(true);
        setTimeout(() => {
          nameInputRef.current?.focus();
        }, 150);
      }
    });
  }, [isOpen, barcode, lang, initialExpirationDate]);

  if (!isOpen) return null;

  const handleApplyPreset = (key: string, dateIso: string) => {
    setSelectedPreset(key);
    setExpirationDate(dateIso);
    setErrorMsg(null);
    triggerHaptic('light');
  };

  const handleExactDateChange = (val: string) => {
    setSelectedPreset(null);
    setExpirationDate(val);
    setErrorMsg(null);
  };

  const handleMonthYearChange = (val: string) => {
    setMonthYearInput(val);
    setSelectedPreset(null);
    const parsed = parseMonthYearExpiration(val);
    if (parsed) {
      setExpirationDate(parsed);
      setErrorMsg(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = productName.trim();
    if (!cleanName) {
      setErrorMsg(t(lang, 'error_enter_product_name'));
      triggerHaptic('error');
      nameInputRef.current?.focus();
      return;
    }

    let finalDate = expirationDate;
    if (dateMode === 'monthYear') {
      const parsed = parseMonthYearExpiration(monthYearInput);
      if (parsed) {
        finalDate = parsed;
      }
    }

    const validation = validateExpirationDate(finalDate, new Date());
    if (!validation.isValid) {
      setErrorMsg(validation.error || t(lang, 'exp_invalid_date'));
      triggerHaptic('error');
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    // If pantry is active, add directly to pantry
    if (currentPantryId) {
      const addRes = await createItem(currentPantryId, {
        barcode: barcode || null,
        name: cleanName,
        quantity,
        expiration_date: finalDate,
      });

      setSaving(false);

      if (addRes.data?.item) {
        triggerHaptic('success');
        if (onItemAdded) {
          onItemAdded(addRes.data.item);
        }
        if (onProductConfirmed) {
          onProductConfirmed({
            barcode: barcode || null,
            name: cleanName,
            quantity,
            expirationDate: finalDate,
          });
        }
        onClose();
        return;
      } else {
        setErrorMsg(addRes.error?.error || t(lang, 'error_add_item_to_pantry'));
        triggerHaptic('error');
        return;
      }
    }

    // Fallback: save to catalog only if barcode is present and no pantry
    if (barcode) {
      const saveRes = await saveProduct(barcode, cleanName, 'manual');
      setSaving(false);

      if (saveRes.data) {
        triggerHaptic('success');
        if (onProductConfirmed) {
          onProductConfirmed({
            barcode,
            name: cleanName,
            quantity,
            expirationDate: finalDate,
          });
        }
        onClose();
      } else {
        setErrorMsg(saveRes.error?.error || t(lang, 'error_save_product'));
        triggerHaptic('error');
      }
    } else {
      setSaving(false);
      if (onProductConfirmed) {
        onProductConfirmed({
          barcode: null,
          name: cleanName,
          quantity,
          expirationDate: finalDate,
        });
      }
      onClose();
    }
  };

  const handleDecQty = () => {
    if (quantity > 1) {
      setQuantity((q) => q - 1);
      triggerHaptic('light');
    }
  };

  const handleIncQty = () => {
    setQuantity((q) => q + 1);
    triggerHaptic('light');
  };

  // Format expiration date for human readable preview
  const formatPreviewDate = (isoStr: string) => {
    if (!isoStr) return '';
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-tg-bg text-tg-text rounded-t-3xl sm:rounded-2xl border border-tg-hint/20 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-slide-up">
        {/* Modal Header */}
        <div className="p-4 border-b border-tg-hint/15 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">{barcode ? '🏷️' : '🍎'}</span>
            <div>
              <div className="flex items-center gap-2">
                {barcode ? (
                  <>
                    <span className="font-mono font-bold text-sm text-tg-text tracking-wide">{barcode}</span>
                    {format && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-tg-secondary text-tg-hint font-semibold">
                        {format}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="font-bold text-sm text-tg-text">{t(lang, 'product_no_barcode_title')}</span>
                )}
              </div>
              <p className="text-[11px] text-tg-hint">
                {barcode
                  ? (loading ? t(lang, 'product_searching') : product ? t(lang, 'product_found') : t(lang, 'product_not_found'))
                  : t(lang, 'product_no_barcode_subtitle')}
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

        {/* Content body */}
        <form onSubmit={handleSave} className="p-4 space-y-4 overflow-y-auto">
          {errorMsg && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl text-xs">
              {errorMsg}
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="py-8 flex flex-col items-center justify-center text-tg-hint gap-3">
              <div className="w-8 h-8 border-3 border-tg-button border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium">{t(lang, 'product_searching')}</p>
            </div>
          )}

          {!loading && (
            <>
              {/* Product Source Badge & Name Label */}
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-tg-hint">
                  {t(lang, 'product_name_label')}:
                </label>
                {!barcode && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                    <span>⚖️</span>
                    <span>{t(lang, 'badge_no_barcode')}</span>
                  </span>
                )}
                {barcode && product?.source === 'off' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 flex items-center gap-1">
                    <span>🌿</span>
                    <span>{t(lang, 'product_source_off')}</span>
                  </span>
                )}
                {barcode && product?.source === 'manual' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-500 border border-blue-500/20 flex items-center gap-1">
                    <span>📦</span>
                    <span>{t(lang, 'product_source_manual')}</span>
                  </span>
                )}
                {barcode && !product && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                    <span>✏️</span>
                    <span>{t(lang, 'product_source_custom')}</span>
                  </span>
                )}
              </div>

              {/* Product Name Display / Input */}
              {isEditingName || !product ? (
                <div className="space-y-1">
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder={barcode ? t(lang, 'product_name_placeholder') : t(lang, 'product_market_placeholder')}
                    className="w-full p-3 rounded-xl bg-tg-secondary border border-tg-hint/25 text-tg-text text-sm focus:outline-none focus:ring-2 focus:ring-tg-button"
                    autoFocus
                  />
                  {!product && barcode && (
                    <p className="text-[11px] text-amber-500 font-medium">
                      {t(lang, 'product_not_in_db_hint')}
                    </p>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-tg-secondary rounded-xl border border-tg-hint/15 flex items-center justify-between">
                  <span className="font-semibold text-sm text-tg-text break-words pr-2">
                    {productName}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingName(true);
                      triggerHaptic('light');
                      setTimeout(() => nameInputRef.current?.focus(), 100);
                    }}
                    className="text-xs text-tg-button hover:underline font-medium shrink-0"
                  >
                    ✏️ {t(lang, 'product_edit_name')}
                  </button>
                </div>
              )}

              {/* Quantity Selector */}
              <div className="pt-2 flex items-center justify-between border-t border-tg-hint/15">
                <div>
                  <div className="text-xs font-semibold text-tg-text">{t(lang, 'product_quantity_label')}</div>
                  <div className="text-[10px] text-tg-hint">{t(lang, 'product_quantity_hint')}</div>
                </div>

                <div className="flex items-center gap-3 bg-tg-secondary p-1.5 rounded-xl border border-tg-hint/15">
                  <button
                    type="button"
                    onClick={handleDecQty}
                    disabled={quantity <= 1}
                    className="w-8 h-8 rounded-lg bg-tg-bg text-tg-text font-bold text-sm flex items-center justify-center disabled:opacity-40 transition active:scale-95"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-bold text-sm text-tg-text">{quantity}</span>
                  <button
                    type="button"
                    onClick={handleIncQty}
                    className="w-8 h-8 rounded-lg bg-tg-bg text-tg-text font-bold text-sm flex items-center justify-center transition active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Stage 4: Expiration Date Section */}
              <div className="pt-3 border-t border-tg-hint/15 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">⏳</span>
                    <label className="text-xs font-bold text-tg-text">
                      {t(lang, 'exp_date_label')}
                    </label>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Stage 8: OCR Date Recognition Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsOcrOpen(true);
                        triggerHaptic('light');
                      }}
                      className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold hover:bg-emerald-500/25 active:scale-95 transition flex items-center gap-1"
                      title={t(lang, 'ocr_scan_btn')}
                    >
                      <span>📷</span>
                      <span>{t(lang, 'ocr_scan_btn')}</span>
                    </button>

                    {/* Mode switcher tabs */}
                    <div className="flex bg-tg-secondary p-0.5 rounded-lg border border-tg-hint/15 text-[10px] font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          setDateMode('exact');
                          triggerHaptic('light');
                        }}
                        className={`px-2 py-1 rounded-md transition ${
                          dateMode === 'exact'
                            ? 'bg-tg-button text-tg-button shadow-xs'
                            : 'text-tg-hint hover:text-tg-text'
                        }`}
                      >
                        {t(lang, 'exp_exact_date_mode')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDateMode('monthYear');
                          triggerHaptic('light');
                        }}
                        className={`px-2 py-1 rounded-md transition ${
                          dateMode === 'monthYear'
                            ? 'bg-tg-button text-tg-button shadow-xs'
                            : 'text-tg-hint hover:text-tg-text'
                        }`}
                      >
                        {t(lang, 'exp_month_year_mode')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quick Presets Buttons (4 pills) */}
                <div className="grid grid-cols-4 gap-1.5">
                  {presets.map((p) => {
                    const presetLabelKey = `exp_preset_${p.key}` as const;
                    const isSelected = selectedPreset === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => handleApplyPreset(p.key, p.dateIso)}
                        className={`py-2 px-1 rounded-xl text-xs font-bold transition flex flex-col items-center justify-center border ${
                          isSelected
                            ? 'bg-tg-button text-tg-button border-tg-button shadow-xs scale-[1.02]'
                            : 'bg-tg-secondary text-tg-text border-tg-hint/15 hover:border-tg-hint/30 active:scale-95'
                        }`}
                      >
                        <span>{t(lang, presetLabelKey)}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Date Inputs based on mode */}
                {dateMode === 'exact' ? (
                  <div>
                    <input
                      type="date"
                      value={expirationDate}
                      onChange={(e) => handleExactDateChange(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-tg-secondary border border-tg-hint/25 text-tg-text text-sm focus:outline-none focus:ring-2 focus:ring-tg-button"
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <input
                      type="text"
                      value={monthYearInput}
                      onChange={(e) => handleMonthYearChange(e.target.value)}
                      placeholder={t(lang, 'date_month_year_placeholder')}
                      className="w-full p-2.5 rounded-xl bg-tg-secondary border border-tg-hint/25 text-tg-text text-sm focus:outline-none focus:ring-2 focus:ring-tg-button"
                    />
                    <p className="text-[10px] text-tg-hint flex items-center gap-1">
                      <span>ℹ️</span>
                      <span>{t(lang, 'exp_month_year_hint')}</span>
                    </p>
                  </div>
                )}

                {/* Selected Date Preview */}
                {expirationDate && (
                  <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between text-xs">
                    <span className="text-tg-hint font-medium">{t(lang, 'product_expires_label')}</span>
                    <span className="font-bold text-emerald-500">
                      {formatPreviewDate(expirationDate)}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-tg-hint/15 flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 px-4 rounded-xl bg-tg-secondary text-tg-text font-medium text-xs transition"
                >
                  {t(lang, 'btn_cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !productName.trim() || !expirationDate}
                  className="flex-2 py-3 px-4 rounded-xl bg-tg-button text-tg-button font-bold text-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98]"
                >
                  {saving ? t(lang, 'item_adding') : `✓ ${t(lang, 'item_add_btn')}`}
                </button>
              </div>
            </>
          )}
        </form>
      </div>

      {/* Stage 8: OCR Date Recognition Modal */}
      <OcrDateScannerModal
        isOpen={isOcrOpen}
        lang={lang}
        onClose={() => setIsOcrOpen(false)}
        onDateSelected={(dateIso) => {
          setExpirationDate(dateIso);
          setDateMode('exact');
          setSelectedPreset(null);
          setErrorMsg(null);
          triggerHaptic('success');
        }}
      />
    </div>
  );
};
