import { describe, it, expect } from 'vitest';
import {
  calculateDaysRemaining,
  getItemFreshness,
  sortItemsByFifo,
  selectFifoItem,
  isSameBatch,
  consolidatePantryItems,
  type InventoryItemLike,
} from '../../shared/inventory.ts';

describe('Stage 5: Pure Inventory Domain Logic', () => {
  const fixedNow = new Date('2026-09-30T12:00:00Z');

  describe('calculateDaysRemaining and getItemFreshness', () => {
    it('correctly classifies expired items (negative days remaining)', () => {
      // 5 days ago: 2026-09-25
      const days5 = calculateDaysRemaining('2026-09-25', fixedNow);
      expect(days5).toBe(-5);
      expect(getItemFreshness('2026-09-25', fixedNow)).toEqual({
        status: 'expired',
        daysRemaining: -5,
      });

      // Yesterday: 2026-09-29
      const days1 = calculateDaysRemaining('2026-09-29', fixedNow);
      expect(days1).toBe(-1);
      expect(getItemFreshness('2026-09-29', fixedNow)).toEqual({
        status: 'expired',
        daysRemaining: -1,
      });
    });

    it('correctly classifies items expiring today (0 days remaining) as warning', () => {
      const days0 = calculateDaysRemaining('2026-09-30', fixedNow);
      expect(days0).toBe(0);
      expect(getItemFreshness('2026-09-30', fixedNow)).toEqual({
        status: 'warning',
        daysRemaining: 0,
      });
    });

    it('correctly classifies items expiring in 1, 2, or 3 days as warning', () => {
      // +1 day: 2026-10-01
      expect(getItemFreshness('2026-10-01', fixedNow)).toEqual({
        status: 'warning',
        daysRemaining: 1,
      });

      // +2 days: 2026-10-02
      expect(getItemFreshness('2026-10-02', fixedNow)).toEqual({
        status: 'warning',
        daysRemaining: 2,
      });

      // +3 days: 2026-10-03
      expect(getItemFreshness('2026-10-03', fixedNow)).toEqual({
        status: 'warning',
        daysRemaining: 3,
      });
    });

    it('correctly classifies items with > 3 days remaining as fresh', () => {
      // +4 days: 2026-10-04
      expect(getItemFreshness('2026-10-04', fixedNow)).toEqual({
        status: 'fresh',
        daysRemaining: 4,
      });

      // +30 days: 2026-10-30
      expect(getItemFreshness('2026-10-30', fixedNow)).toEqual({
        status: 'fresh',
        daysRemaining: 30,
      });
    });
  });

  describe('sortItemsByFifo', () => {
    it('sorts items by expiration date ascending', () => {
      const items: InventoryItemLike[] = [
        { id: '1', pantry_id: 'p1', barcode: '111', name: 'Йогурт', expiration_date: '2026-10-15', quantity: 1, status: 'active' },
        { id: '2', pantry_id: 'p1', barcode: '111', name: 'Молоко', expiration_date: '2026-10-02', quantity: 2, status: 'active' },
        { id: '3', pantry_id: 'p1', barcode: '222', name: 'Сыр', expiration_date: '2026-10-08', quantity: 1, status: 'active' },
      ];

      const sorted = sortItemsByFifo(items);
      expect(sorted[0].id).toBe('2'); // 2026-10-02
      expect(sorted[1].id).toBe('3'); // 2026-10-08
      expect(sorted[2].id).toBe('1'); // 2026-10-15
    });
  });

  describe('selectFifoItem', () => {
    const items: InventoryItemLike[] = [
      { id: 'batch-later', pantry_id: 'p1', barcode: '4607004891234', name: 'Молоко 3.2%', expiration_date: '2026-10-10', quantity: 2, status: 'active' },
      { id: 'batch-earlier', pantry_id: 'p1', barcode: '4607004891234', name: 'Молоко 3.2%', expiration_date: '2026-10-03', quantity: 1, status: 'active' },
      { id: 'batch-closed', pantry_id: 'p1', barcode: '4607004891234', name: 'Молоко 3.2%', expiration_date: '2026-09-25', quantity: 1, status: 'consumed' },
      { id: 'other-product', pantry_id: 'p1', barcode: '4600000000000', name: 'Кефир', expiration_date: '2026-10-01', quantity: 1, status: 'active' },
    ];

    it('returns null if no active item matches barcode', () => {
      expect(selectFifoItem(items, '9999999999999')).toBeNull();
    });

    it('selects the earliest active batch (FIFO principle) and detects multiple batches', () => {
      const res = selectFifoItem(items, '4607004891234');
      expect(res).not.toBeNull();
      expect(res?.earliestItem.id).toBe('batch-earlier');
      expect(res?.earliestItem.expiration_date).toBe('2026-10-03');
      expect(res?.hasMultipleBatches).toBe(true);
      expect(res?.matchingItems).toHaveLength(2); // batch-earlier and batch-later, consumed ignored
    });

    it('returns hasMultipleBatches: false when all matching items share the exact same expiration date', () => {
      const singleDateItems: InventoryItemLike[] = [
        { id: 'a', pantry_id: 'p1', barcode: '123', name: 'Хлеб', expiration_date: '2026-10-05', quantity: 1, status: 'active' },
        { id: 'b', pantry_id: 'p1', barcode: '123', name: 'Хлеб', expiration_date: '2026-10-05', quantity: 2, status: 'active' },
      ];

      const res = selectFifoItem(singleDateItems, '123');
      expect(res).not.toBeNull();
      expect(res?.hasMultipleBatches).toBe(false);
      expect(res?.earliestItem.id).toBe('a');
    });
  });

  describe('isSameBatch', () => {
    it('returns true when barcode and expiration_date are identical', () => {
      expect(
        isSameBatch(
          { barcode: '4601234567890', name: 'Молоко', expiration_date: '2026-10-15' },
          { barcode: '4601234567890', name: 'Молоко 3.2%', expiration_date: '2026-10-15' }
        )
      ).toBe(true);
    });

    it('returns false when expiration_dates differ even with same barcode', () => {
      expect(
        isSameBatch(
          { barcode: '4601234567890', name: 'Молоко', expiration_date: '2026-10-15' },
          { barcode: '4601234567890', name: 'Молоко', expiration_date: '2026-10-20' }
        )
      ).toBe(false);
    });

    it('returns true when both have no barcode but matching trimmed lowercase name and same date', () => {
      expect(
        isSameBatch(
          { barcode: null, name: 'Хлеб бородинский ', expiration_date: '2026-10-05' },
          { barcode: null, name: 'хлеб бородинский', expiration_date: '2026-10-05' }
        )
      ).toBe(true);
    });

    it('returns false when one has barcode and other does not', () => {
      expect(
        isSameBatch(
          { barcode: '123', name: 'Товар', expiration_date: '2026-10-05' },
          { barcode: null, name: 'Товар', expiration_date: '2026-10-05' }
        )
      ).toBe(false);
    });
  });

  describe('consolidatePantryItems', () => {
    it('consolidates duplicates of the same batch into a single position with summed quantity', () => {
      const items: InventoryItemLike[] = [
        { id: 'item-1', pantry_id: 'p1', barcode: '4601234567890', name: 'Молоко', expiration_date: '2026-10-15', quantity: 1, status: 'active' },
        { id: 'item-2', pantry_id: 'p1', barcode: '4601234567890', name: 'Молоко', expiration_date: '2026-10-15', quantity: 1, status: 'active' },
        { id: 'item-3', pantry_id: 'p1', barcode: '4601234567890', name: 'Молоко', expiration_date: '2026-10-20', quantity: 1, status: 'active' }, // different date
      ];

      const res = consolidatePantryItems(items);
      expect(res.consolidated).toHaveLength(2);
      expect(res.consolidated[0].id).toBe('item-1');
      expect(res.consolidated[0].quantity).toBe(2);
      expect(res.consolidated[1].id).toBe('item-3');
      expect(res.consolidated[1].quantity).toBe(1);

      expect(res.duplicatesToRemove).toEqual(['item-2']);
      expect(res.updatedQuantities.get('item-1')).toBe(2);
    });
  });
});

