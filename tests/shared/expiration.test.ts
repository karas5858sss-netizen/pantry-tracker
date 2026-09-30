import { describe, it, expect } from 'vitest';
import {
  isLeapYear,
  getDaysInMonth,
  addDays,
  addMonths,
  getExpirationPresets,
  parseMonthYearExpiration,
  validateExpirationDate,
} from '../../shared/expiration.ts';

describe('Stage 4: Expiration Date Helpers & Leap Year Logic', () => {
  const fixedNow = new Date('2026-09-30T12:00:00Z');

  describe('isLeapYear', () => {
    it('correctly identifies standard leap years', () => {
      expect(isLeapYear(2024)).toBe(true);
      expect(isLeapYear(2028)).toBe(true);
      expect(isLeapYear(2032)).toBe(true);
    });

    it('correctly identifies non-leap years', () => {
      expect(isLeapYear(2025)).toBe(false);
      expect(isLeapYear(2026)).toBe(false);
      expect(isLeapYear(2027)).toBe(false);
    });

    it('correctly handles century leap year rules', () => {
      // 2000 is divisible by 400 -> leap year
      expect(isLeapYear(2000)).toBe(true);
      // 2100 is divisible by 100 but not 400 -> NOT a leap year
      expect(isLeapYear(2100)).toBe(false);
      expect(isLeapYear(1900)).toBe(false);
      expect(isLeapYear(2400)).toBe(true);
    });
  });

  describe('getDaysInMonth', () => {
    it('returns 31 for January, March, May, July, August, October, December', () => {
      [1, 3, 5, 7, 8, 10, 12].forEach((m) => {
        expect(getDaysInMonth(2026, m)).toBe(31);
      });
    });

    it('returns 30 for April, June, September, November', () => {
      [4, 6, 9, 11].forEach((m) => {
        expect(getDaysInMonth(2026, m)).toBe(30);
      });
    });

    it('returns 29 for February in leap years and 28 in common years', () => {
      expect(getDaysInMonth(2028, 2)).toBe(29);
      expect(getDaysInMonth(2024, 2)).toBe(29);
      expect(getDaysInMonth(2027, 2)).toBe(28);
      expect(getDaysInMonth(2026, 2)).toBe(28);
      expect(getDaysInMonth(2100, 2)).toBe(28);
      expect(getDaysInMonth(2000, 2)).toBe(29);
    });
  });

  describe('addDays and addMonths presets', () => {
    it('calculates +3 days and +7 days from fixed date', () => {
      expect(addDays(fixedNow, 3)).toBe('2026-10-03');
      expect(addDays(fixedNow, 7)).toBe('2026-10-07');
    });

    it('calculates +1 month and +6 months from fixed date', () => {
      expect(addMonths(fixedNow, 1)).toBe('2026-10-30');
      expect(addMonths(fixedNow, 6)).toBe('2027-03-30');
    });

    it('clamps month-end correctly when adding months (e.g. Jan 31 -> Feb 28/29)', () => {
      const jan31Common = new Date('2027-01-31T12:00:00Z');
      expect(addMonths(jan31Common, 1)).toBe('2027-02-28');

      const jan31Leap = new Date('2028-01-31T12:00:00Z');
      expect(addMonths(jan31Leap, 1)).toBe('2028-02-29');

      const mar31 = new Date('2026-03-31T12:00:00Z');
      expect(addMonths(mar31, 1)).toBe('2026-04-30');
    });

    it('getExpirationPresets returns all 4 standard presets', () => {
      const presets = getExpirationPresets(fixedNow);
      expect(presets).toHaveLength(4);
      expect(presets.find((p) => p.key === '3d')?.dateIso).toBe('2026-10-03');
      expect(presets.find((p) => p.key === '7d')?.dateIso).toBe('2026-10-07');
      expect(presets.find((p) => p.key === '1m')?.dateIso).toBe('2026-10-30');
      expect(presets.find((p) => p.key === '6m')?.dateIso).toBe('2027-03-30');
    });
  });

  describe('parseMonthYearExpiration (rule: last day of month)', () => {
    it('parses MM/YYYY to last day of that month', () => {
      expect(parseMonthYearExpiration('10/2026')).toBe('2026-10-31');
      expect(parseMonthYearExpiration('04/2026')).toBe('2026-04-30');
      expect(parseMonthYearExpiration('12/2026')).toBe('2026-12-31');
    });

    it('parses MM.YYYY or MM-YYYY formats', () => {
      expect(parseMonthYearExpiration('10.2026')).toBe('2026-10-31');
      expect(parseMonthYearExpiration('09-2026')).toBe('2026-09-30');
    });

    it('parses short year MM/YY or MM.YY', () => {
      expect(parseMonthYearExpiration('05/27')).toBe('2027-05-31');
      expect(parseMonthYearExpiration('11.26')).toBe('2026-11-30');
    });

    it('calculates February 29th for leap years and 28th for common years', () => {
      expect(parseMonthYearExpiration('02/2028')).toBe('2028-02-29');
      expect(parseMonthYearExpiration('02/2024')).toBe('2024-02-29');
      expect(parseMonthYearExpiration('02/2027')).toBe('2027-02-28');
      expect(parseMonthYearExpiration('02/2026')).toBe('2026-02-28');
      expect(parseMonthYearExpiration('02/28')).toBe('2028-02-29');
      expect(parseMonthYearExpiration('02/27')).toBe('2027-02-28');
    });

    it('returns null for invalid inputs', () => {
      expect(parseMonthYearExpiration('')).toBeNull();
      expect(parseMonthYearExpiration('abc')).toBeNull();
      expect(parseMonthYearExpiration('13/2026')).toBeNull();
      expect(parseMonthYearExpiration('00/2026')).toBeNull();
    });
  });

  describe('validateExpirationDate', () => {
    it('accepts valid dates inside range "today - 1 year ... today + 10 years"', () => {
      expect(validateExpirationDate('2026-10-05', fixedNow).isValid).toBe(true);
      expect(validateExpirationDate('2027-05-15', fixedNow).isValid).toBe(true);
      expect(validateExpirationDate('2035-01-01', fixedNow).isValid).toBe(true);
      // Valid historical date (e.g. expired 2 months ago)
      expect(validateExpirationDate('2026-07-01', fixedNow).isValid).toBe(true);
    });

    it('rejects dates older than 1 year', () => {
      const res = validateExpirationDate('2024-01-01', fixedNow);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('слишком старый');
    });

    it('rejects dates beyond 10 years in the future', () => {
      const res = validateExpirationDate('2038-01-01', fixedNow);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('10 лет');
    });

    it('rejects non-existent calendar days (e.g. Feb 30 or Nov 31)', () => {
      expect(validateExpirationDate('2026-02-30', fixedNow).isValid).toBe(false);
      expect(validateExpirationDate('2026-04-31', fixedNow).isValid).toBe(false);
      expect(validateExpirationDate('2027-02-29', fixedNow).isValid).toBe(false);
    });
  });
});
