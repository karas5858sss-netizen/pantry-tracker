import { describe, it, expect } from 'vitest';
import {
  extractOffProductName,
  extractUpcProductName,
  cleanProductName,
  getOffApiUrl,
  getOpfApiUrl,
  getObfApiUrl,
  getUpcItemDbUrl,
  OFF_USER_AGENT,
} from '../../shared/products.ts';

describe('Shared Products & Multi-database parsing', () => {
  it('builds proper API urls for all providers', () => {
    expect(getOffApiUrl('4607004891118')).toBe(
      'https://world.openfoodfacts.org/api/v2/product/4607004891118.json'
    );
    expect(getOpfApiUrl('4006381333931')).toBe(
      'https://world.openproductsfacts.org/api/v2/product/4006381333931.json'
    );
    expect(getObfApiUrl('3600523724832')).toBe(
      'https://world.openbeautyfacts.org/api/v2/product/3600523724832.json'
    );
    expect(getUpcItemDbUrl('4006381333931')).toBe(
      'https://api.upcitemdb.com/prod/trial/lookup?upc=4006381333931'
    );
  });

  describe('extractUpcProductName', () => {
    it('returns null on invalid response', () => {
      expect(extractUpcProductName(null)).toBeNull();
      expect(extractUpcProductName({})).toBeNull();
      expect(extractUpcProductName({ code: 'INVALID' })).toBeNull();
      expect(extractUpcProductName({ code: 'OK', items: [] })).toBeNull();
    });

    it('extracts and cleans title from UPCitemdb items', () => {
      const upcData = {
        code: 'OK',
        total: 1,
        items: [
          {
            title: '  Stabilo Point 88 Fineliner Marker Pen  ',
            brand: 'STABILO',
          },
        ],
      };
      expect(extractUpcProductName(upcData)).toBe('Stabilo Point 88 Fineliner Marker Pen');
    });
  });

  it('defines valid non-empty user-agent', () => {
    expect(OFF_USER_AGENT).toContain('PantryTracker');
  });

  it('cleanProductName normalizes whitespace and rejects blanks', () => {
    expect(cleanProductName(null)).toBeNull();
    expect(cleanProductName('')).toBeNull();
    expect(cleanProductName('   ')).toBeNull();
    expect(cleanProductName('  Молоко   3.2%  ')).toBe('Молоко 3.2%');
  });

  describe('extractOffProductName', () => {
    it('returns null on falsy or non-object responses', () => {
      expect(extractOffProductName(null)).toBeNull();
      expect(extractOffProductName(undefined)).toBeNull();
      expect(extractOffProductName('')).toBeNull();
      expect(extractOffProductName(123)).toBeNull();
      expect(extractOffProductName({})).toBeNull();
    });

    it('returns null if status is not 1 (e.g. 0 = product not found)', () => {
      expect(
        extractOffProductName({
          status: 0,
          status_verbose: 'product not found',
        })
      ).toBeNull();
    });

    it('prefers localized product_name_<lang> for Russian', () => {
      const offData = {
        status: 1,
        product: {
          product_name: 'Nutella Generic',
          product_name_ru: 'Ореховая паста Nutella',
          product_name_es: 'Crema de avellanas Nutella',
          product_name_en: 'Hazelnut spread Nutella',
        },
      };

      expect(extractOffProductName(offData, 'ru')).toBe('Ореховая паста Nutella');
      expect(extractOffProductName(offData, 'es')).toBe('Crema de avellanas Nutella');
      expect(extractOffProductName(offData, 'en')).toBe('Hazelnut spread Nutella');
    });

    it('falls back to product_name if localized version is missing', () => {
      const offData = {
        status: 1,
        product: {
          product_name: 'Barilla Spaghetti No 5',
          product_name_es: 'Spaghetti Barilla',
        },
      };

      // For Russian, product_name_ru is missing, so it should fall back to product_name
      expect(extractOffProductName(offData, 'ru')).toBe('Barilla Spaghetti No 5');
    });

    it('falls back to generic_name when product_name is absent', () => {
      const offData = {
        status: 1,
        product: {
          generic_name_ru: 'Шоколад молочный',
          generic_name: 'Milk chocolate',
        },
      };

      expect(extractOffProductName(offData, 'ru')).toBe('Шоколад молочный');
      expect(extractOffProductName(offData, 'en')).toBe('Milk chocolate');
    });

    it('ignores empty strings and whitespace in prioritized fields', () => {
      const offData = {
        status: 1,
        product: {
          product_name_ru: '   ',
          product_name: '   BonAqua   ',
        },
      };

      expect(extractOffProductName(offData, 'ru')).toBe('BonAqua');
    });
  });
});
