import React, { useState, useEffect, useRef } from 'react';
import { type ProductInfo, lookupProduct, saveProduct } from '../api.ts';
import { t, type SupportedLanguage } from '@shared/i18n.ts';
import { triggerHaptic } from '../telegram.ts';

interface ProductCardModalProps {
  isOpen: boolean;
  barcode: string;
  format?: string;
  lang: SupportedLanguage;
  onClose: () => void;
  onProductConfirmed?: (product: { barcode: string; name: string; quantity: number }) => void;
}

export const ProductCardModal: React.FC<ProductCardModalProps> = ({
  isOpen,
  barcode,
  format,
  lang,
  onClose,
  onProductConfirmed,
}) => {
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [productName, setProductName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !barcode) return;

    setLoading(true);
    setProduct(null);
    setProductName('');
    setIsEditingName(false);
    setQuantity(1);
    setErrorMsg(null);

    lookupProduct(barcode, lang).then((res) => {
      setLoading(false);
      if (res.found && res.product) {
        setProduct(res.product);
        setProductName(res.product.name);
        triggerHaptic('success');
      } else {
        // Not found -> trigger haptic warning/error and focus name input
        triggerHaptic('error');
        setIsEditingName(true);
        setTimeout(() => {
          nameInputRef.current?.focus();
        }, 150);
      }
    });
  }, [isOpen, barcode, lang]);

  if (!isOpen || !barcode) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = productName.trim();
    if (!cleanName) {
      setErrorMsg('Введите название товара');
      triggerHaptic('error');
      nameInputRef.current?.focus();
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    // Save to products catalog
    const saveRes = await saveProduct(barcode, cleanName, 'manual');
    setSaving(false);

    if (saveRes.data) {
      triggerHaptic('success');
      if (onProductConfirmed) {
        onProductConfirmed({
          barcode,
          name: cleanName,
          quantity,
        });
      }
      onClose();
    } else {
      setErrorMsg(saveRes.error?.error || 'Не удалось сохранить товар');
      triggerHaptic('error');
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

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-tg-bg text-tg-text rounded-t-3xl sm:rounded-2xl border border-tg-hint/20 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-slide-up">
        {/* Modal Header */}
        <div className="p-4 border-b border-tg-hint/15 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏷️</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm text-tg-text tracking-wide">{barcode}</span>
                {format && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-tg-secondary text-tg-hint font-semibold">
                    {format}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-tg-hint">
                {loading ? t(lang, 'product_searching') : product ? t(lang, 'product_found') : t(lang, 'product_not_found')}
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
              {/* Product Source Badge */}
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-tg-hint">
                  {t(lang, 'product_name_label')}:
                </label>
                {product?.source === 'off' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 flex items-center gap-1">
                    <span>🌿</span>
                    <span>{t(lang, 'product_source_off')}</span>
                  </span>
                )}
                {product?.source === 'manual' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-500 border border-blue-500/20 flex items-center gap-1">
                    <span>📦</span>
                    <span>{t(lang, 'product_source_manual')}</span>
                  </span>
                )}
                {!product && (
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
                    placeholder={t(lang, 'product_name_placeholder')}
                    className="w-full p-3 rounded-xl bg-tg-secondary border border-tg-hint/25 text-tg-text text-sm focus:outline-none focus:ring-2 focus:ring-tg-button"
                    autoFocus
                  />
                  {!product && (
                    <p className="text-[11px] text-amber-500 font-medium">
                      ⚠️ Товар пока отсутствует в базе. Введите название — оно сохранится в каталоге!
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
                  <div className="text-[10px] text-tg-hint">Количество единиц товара</div>
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
                  disabled={saving || !productName.trim()}
                  className="flex-2 py-3 px-4 rounded-xl bg-tg-button text-tg-button font-bold text-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {saving ? 'Сохранение...' : `✓ ${t(lang, 'product_save_btn')}`}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
