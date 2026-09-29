import { describe, it, expect } from 'vitest';
import {
  extractOffProductName,
  cleanProductName,
  getOffApiUrl,
  OFF_USER_AGENT,
} from '../../shared/products.ts';

describe('Shared Products & Open Food Facts parsing', () => {
  it('builds proper Open Food Facts v2 API url', () => {
    expect(getOffApiUrl('4607004891118')).toBe(
      'https://world.openfoodfacts.org/api/v2/product/4607004891118.json'
    );
    expect(getOffApiUrl('  4006381333931  ')).toBe(
      'https://world.openfoodfacts.org/api/v2/product/4006381333931.json'
    );
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
