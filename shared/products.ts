/**
 * Pure helper functions and types for product resolution and Open Food Facts API parsing.
 */

export type ProductSource = 'manual' | 'off';

export interface ProductItem {
  barcode: string;
  name: string;
  source: ProductSource;
  updated_at?: string;
}

export interface OffProductData {
  status?: number;
  code?: string;
  product?: {
    product_name?: string;
    product_name_ru?: string;
    product_name_es?: string;
    product_name_en?: string;
    generic_name?: string;
    generic_name_ru?: string;
    generic_name_es?: string;
    generic_name_en?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export const OFF_USER_AGENT = 'PantryTracker/1.0 (+https://github.com/karas5858sss-netizen/pantry-tracker)';

/**
 * Returns the Open Food Facts API v2 endpoint for a barcode.
 */
export function getOffApiUrl(barcode: string): string {
  const cleanBarcode = barcode.trim();
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`;
}

/**
 * Returns the Open Products Facts API v2 endpoint (non-food household goods).
 */
export function getOpfApiUrl(barcode: string): string {
  const cleanBarcode = barcode.trim();
  return `https://world.openproductsfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`;
}

/**
 * Returns the Open Beauty Facts API v2 endpoint (cosmetics & personal hygiene).
 */
export function getObfApiUrl(barcode: string): string {
  const cleanBarcode = barcode.trim();
  return `https://world.openbeautyfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`;
}

/**
 * Returns the UPCitemdb lookup endpoint (general retail products).
 */
export function getUpcItemDbUrl(barcode: string): string {
  const cleanBarcode = barcode.trim();
  return `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(cleanBarcode)}`;
}

/**
 * Extracts product name from UPCitemdb response.
 */
export function extractUpcProductName(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const upc = data as { code?: string; items?: Array<{ title?: string }> };
  if (upc.code === 'OK' && Array.isArray(upc.items) && upc.items.length > 0) {
    return cleanProductName(upc.items[0]?.title);
  }
  return null;
}

/**
 * Cleans up and normalizes product name.
 */
export function cleanProductName(name?: string | null): string | null {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extracts the best localized product name from an Open Food Facts response.
 * Priority:
 * 1. product_name_<lang>
 * 2. product_name
 * 3. generic_name_<lang>
 * 4. generic_name
 */
export function extractOffProductName(data: unknown, lang: 'ru' | 'es' | 'en' = 'ru'): string | null {
  if (!data || typeof data !== 'object') return null;

  const off = data as OffProductData;
  if (off.status !== 1 || !off.product || typeof off.product !== 'object') {
    return null;
  }

  const prod = off.product;
  const langKey = `product_name_${lang}` as keyof typeof prod;
  const genericLangKey = `generic_name_${lang}` as keyof typeof prod;

  const candidates = [
    cleanProductName(prod[langKey] as string),
    cleanProductName(prod.product_name),
    cleanProductName(prod[genericLangKey] as string),
    cleanProductName(prod.generic_name),
    cleanProductName(prod.product_name_en),
  ];

  for (const name of candidates) {
    if (name) return name;
  }

  return null;
}
