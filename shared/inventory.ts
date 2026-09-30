/**
 * Pure domain logic for inventory management, freshness calculation, and FIFO resolution.
 * 100% deterministic and testable by injecting `now: Date`.
 */

export interface ItemFreshness {
  status: 'expired' | 'warning' | 'fresh';
  daysRemaining: number;
}

/**
 * Calculates calendar days remaining between `expirationDateIso` (YYYY-MM-DD) and `now`.
 * - Negative daysRemaining: expired.
 * - 0 daysRemaining: expires today.
 * - 1..3 daysRemaining: expiring soon (warning).
 * - >3 daysRemaining: fresh.
 */
export function calculateDaysRemaining(expirationDateIso: string, now: Date): number {
  const [yearStr, monthStr, dayStr] = expirationDateIso.split('-');
  const expYear = parseInt(yearStr, 10);
  const expMonth = parseInt(monthStr, 10);
  const expDay = parseInt(dayStr, 10);

  // Normalize to UTC midnight
  const expUtc = Date.UTC(expYear, expMonth - 1, expDay);
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((expUtc - nowUtc) / msPerDay);
}

/**
 * Determines freshness status of an item.
 */
export function getItemFreshness(expirationDateIso: string, now: Date): ItemFreshness {
  const daysRemaining = calculateDaysRemaining(expirationDateIso, now);

  if (daysRemaining < 0) {
    return { status: 'expired', daysRemaining };
  }
  if (daysRemaining <= 3) {
    return { status: 'warning', daysRemaining };
  }
  return { status: 'fresh', daysRemaining };
}

export interface InventoryItemLike {
  id: string;
  pantry_id: string;
  barcode: string | null;
  name: string;
  expiration_date: string;
  quantity: number;
  status: 'active' | 'consumed' | 'discarded';
}

export interface FifoResolution<T extends InventoryItemLike = InventoryItemLike> {
  earliestItem: T;
  hasMultipleBatches: boolean;
  matchingItems: T[];
}

/**
 * Sorts inventory items by expiration date ascending (FIFO order: earliest expiring first).
 */
export function sortItemsByFifo<T extends InventoryItemLike>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const cmp = a.expiration_date.localeCompare(b.expiration_date);
    if (cmp !== 0) return cmp;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Selects the next item to consume by barcode using FIFO (First-In, First-Out).
 * If multiple active items with this barcode exist with different expiration dates,
 * flags `hasMultipleBatches: true`.
 */
export function selectFifoItem<T extends InventoryItemLike>(
  items: T[],
  barcode: string
): FifoResolution<T> | null {
  const cleanBarcode = barcode.trim();
  const matching = items.filter(
    (item) => item.status === 'active' && item.barcode && item.barcode.trim() === cleanBarcode
  );

  if (matching.length === 0) {
    return null;
  }

  const sorted = sortItemsByFifo(matching);
  const earliestItem = sorted[0];

  // Check if there are different expiration dates
  const uniqueDates = new Set(sorted.map((item) => item.expiration_date));
  const hasMultipleBatches = uniqueDates.size > 1;

  return {
    earliestItem,
    hasMultipleBatches,
    matchingItems: sorted,
  };
}

/**
 * Checks if two items belong to the same batch (same expiration date and matching barcode/name).
 */
export function isSameBatch(
  itemA: { barcode: string | null; name: string; expiration_date: string },
  itemB: { barcode: string | null; name: string; expiration_date: string }
): boolean {
  if (itemA.expiration_date !== itemB.expiration_date) {
    return false;
  }
  const barcodeA = itemA.barcode ? itemA.barcode.trim() : null;
  const barcodeB = itemB.barcode ? itemB.barcode.trim() : null;
  if (barcodeA && barcodeB) {
    return barcodeA === barcodeB;
  }
  if (!barcodeA && !barcodeB) {
    return itemA.name.trim().toLowerCase() === itemB.name.trim().toLowerCase();
  }
  return false;
}

export interface ConsolidateResult<T extends InventoryItemLike> {
  consolidated: T[];
  duplicatesToRemove: string[];
  updatedQuantities: Map<string, number>;
}

/**
 * Consolidates duplicate active items with the exact same batch (same expiration date and barcode/name).
 * Merges quantities into the first occurrence and tracks duplicates to remove.
 */
export function consolidatePantryItems<T extends InventoryItemLike>(items: T[]): ConsolidateResult<T> {
  const consolidated: T[] = [];
  const duplicatesToRemove: string[] = [];
  const updatedQuantities = new Map<string, number>();

  for (const item of items) {
    const existingIndex = consolidated.findIndex((c) => isSameBatch(c, item));
    if (existingIndex !== -1) {
      const primary = consolidated[existingIndex];
      const newQty = primary.quantity + item.quantity;
      primary.quantity = newQty;
      duplicatesToRemove.push(item.id);
      updatedQuantities.set(primary.id, newQty);
    } else {
      consolidated.push({ ...item });
    }
  }

  return {
    consolidated,
    duplicatesToRemove,
    updatedQuantities,
  };
}

