import { describe, it, expect } from 'vitest';
import {
  cleanBarcode,
  calculateEanCheckDigit,
  isValidEan13,
  isValidEan8,
  isValidEan,
  validateEanInput,
} from '../../shared/ean.ts';

describe('cleanBarcode', () => {
  it('strips spaces, dashes, and underscores', () => {
    expect(cleanBarcode(' 4006-381_333 931 ')).toBe('4006381333931');
    expect(cleanBarcode('4012-3455')).toBe('40123455');
  });

  it('handles empty or non-string input safely', () => {
    expect(cleanBarcode('')).toBe('');
    // @ts-expect-error testing invalid type runtime safety
    expect(cleanBarcode(null)).toBe('');
    // @ts-expect-error testing invalid type runtime safety
    expect(cleanBarcode(undefined)).toBe('');
  });
});

describe('calculateEanCheckDigit', () => {
  it('calculates correct check digit for 12-digit EAN-13 payloads', () => {
    // 400638133393 -> 1
    expect(calculateEanCheckDigit('400638133393')).toBe(1);
    // 544900000099 -> 6
    expect(calculateEanCheckDigit('544900000099')).toBe(6);
    // 460000000000 -> 8
    expect(calculateEanCheckDigit('460000000000')).toBe(8);
    // 841010000000 -> 8
    expect(calculateEanCheckDigit('841010000000')).toBe(8);
  });

  it('calculates correct check digit for 7-digit EAN-8 payloads', () => {
    // 4012345 -> 5
    expect(calculateEanCheckDigit('4012345')).toBe(5);
    // 9638507 -> 4
    expect(calculateEanCheckDigit('9638507')).toBe(4);
  });

  it('returns null for invalid inputs', () => {
    expect(calculateEanCheckDigit('')).toBeNull();
    expect(calculateEanCheckDigit('12345a7')).toBeNull();
    expect(calculateEanCheckDigit('   ')).toBeNull();
  });
});

describe('isValidEan13', () => {
  it('accepts valid EAN-13 barcodes', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('5449000000996')).toBe(true);
    expect(isValidEan13('460000000008')).toBe(false); // only 12 digits
    expect(isValidEan13('4600000000008')).toBe(true);
    expect(isValidEan13('8410100000008')).toBe(true);
    expect(isValidEan13('7350053850019')).toBe(true);
  });

  it('rejects EAN-13 with corrupted check digit', () => {
    expect(isValidEan13('4006381333930')).toBe(false);
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('5449000000990')).toBe(false);
  });

  it('rejects barcodes with wrong length or non-numeric characters', () => {
    expect(isValidEan13('40123455')).toBe(false); // EAN-8
    expect(isValidEan13('400638133393')).toBe(false); // 12 digits
    expect(isValidEan13('40063813339310')).toBe(false); // 14 digits
    expect(isValidEan13('400638133393X')).toBe(false);
  });
});

describe('isValidEan8', () => {
  it('accepts valid EAN-8 barcodes', () => {
    expect(isValidEan8('40123455')).toBe(true);
    expect(isValidEan8('96385074')).toBe(true);
  });

  it('rejects EAN-8 with corrupted check digit', () => {
    expect(isValidEan8('40123450')).toBe(false);
    expect(isValidEan8('40123459')).toBe(false);
    expect(isValidEan8('96385070')).toBe(false);
  });

  it('rejects barcodes with wrong length or non-numeric characters', () => {
    expect(isValidEan8('4006381333931')).toBe(false); // EAN-13
    expect(isValidEan8('4012345')).toBe(false); // 7 digits
    expect(isValidEan8('401234555')).toBe(false); // 9 digits
    expect(isValidEan8('4012345A')).toBe(false);
  });
});

describe('isValidEan', () => {
  it('accepts both EAN-13 and EAN-8 valid codes', () => {
    expect(isValidEan('4006381333931')).toBe(true);
    expect(isValidEan('40123455')).toBe(true);
    expect(isValidEan(' 4012-3455 ')).toBe(true);
  });

  it('rejects invalid barcodes', () => {
    expect(isValidEan('123456')).toBe(false);
    expect(isValidEan('4006381333939')).toBe(false);
    expect(isValidEan('40123450')).toBe(false);
  });
});

describe('validateEanInput', () => {
  it('returns valid result for correct EAN-13', () => {
    const res = validateEanInput('4006381333931');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('4006381333931');
    expect(res.type).toBe('EAN-13');
    expect(res.actualCheckDigit).toBe(1);
    expect(res.expectedCheckDigit).toBe(1);
    expect(res.error).toBeUndefined();
  });

  it('returns valid result for correct EAN-8', () => {
    const res = validateEanInput('40123455');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('40123455');
    expect(res.type).toBe('EAN-8');
    expect(res.actualCheckDigit).toBe(5);
    expect(res.expectedCheckDigit).toBe(5);
  });

  it('handles empty input', () => {
    const res = validateEanInput('');
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Введите штрихкод');
  });

  it('handles non-numeric characters', () => {
    const res = validateEanInput('400638133393A');
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('только цифры');
  });

  it('handles incorrect length', () => {
    const res = validateEanInput('12345');
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Неверная длина');
  });

  it('handles incorrect check digit with helpful explanation', () => {
    const res = validateEanInput('4006381333935');
    expect(res.isValid).toBe(false);
    expect(res.actualCheckDigit).toBe(5);
    expect(res.expectedCheckDigit).toBe(1);
    expect(res.error).toContain('Неверная контрольная цифра');
  });
});
