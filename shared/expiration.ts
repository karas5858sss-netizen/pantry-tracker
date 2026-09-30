/**
 * Pure helper functions for expiration date calculation, presets, and validation.
 * Deterministic: accepts `now: Date` parameter for 100% test reproducibility.
 */

export interface ExpirationPreset {
  key: '3d' | '7d' | '1m' | '6m';
  daysOrMonths: { type: 'days' | 'months'; value: number };
  dateIso: string;
}

/**
 * Checks if a given year is a leap year according to the Gregorian calendar:
 * Divisible by 4, but not by 100, unless also divisible by 400.
 */
export function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

/**
 * Returns the exact number of days in a given month (1-indexed: 1 = Jan, 12 = Dec).
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }
  return 31;
}

/**
 * Formats a Date object to 'YYYY-MM-DD' ISO format.
 */
export function formatDateIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adds N days to `now` and returns ISO 'YYYY-MM-DD'.
 */
export function addDays(now: Date, days: number): string {
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  target.setUTCDate(target.getUTCDate() + days);
  return formatDateIso(target);
}

/**
 * Adds N calendar months to `now` and returns ISO 'YYYY-MM-DD'.
 * Handles month-end clamping (e.g. Jan 31 + 1 month -> Feb 28/29).
 */
export function addMonths(now: Date, months: number): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  const day = now.getUTCDate();

  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1; // 1-indexed

  const maxDays = getDaysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(day, maxDays);

  const target = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay));
  return formatDateIso(target);
}

/**
 * Calculates standard expiration presets from a given `now`:
 * +3 days, +7 days, +1 month, +6 months.
 */
export function getExpirationPresets(now: Date): ExpirationPreset[] {
  return [
    { key: '3d', daysOrMonths: { type: 'days', value: 3 }, dateIso: addDays(now, 3) },
    { key: '7d', daysOrMonths: { type: 'days', value: 7 }, dateIso: addDays(now, 7) },
    { key: '1m', daysOrMonths: { type: 'months', value: 1 }, dateIso: addMonths(now, 1) },
    { key: '6m', daysOrMonths: { type: 'months', value: 6 }, dateIso: addMonths(now, 6) },
  ];
}

/**
 * Parses user input in format MM/YYYY, MM.YYYY, MM-YYYY, MM/YY, MM.YY, or YYYY-MM.
 * Specification rule: Month/Year input is considered the LAST DAY OF THAT MONTH!
 * Example: '10/2026' -> '2026-10-31', '02/2028' -> '2028-02-29'.
 */
export function parseMonthYearExpiration(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // 1. Try MM/YYYY or MM.YYYY or MM-YYYY
  const mmyyyyMatch = trimmed.match(/^(\d{1,2})[./\-](\d{4})$/);
  if (mmyyyyMatch) {
    const month = parseInt(mmyyyyMatch[1], 10);
    const year = parseInt(mmyyyyMatch[2], 10);
    if (month >= 1 && month <= 12 && year >= 1900 && year <= 2150) {
      const lastDay = getDaysInMonth(year, month);
      const mm = String(month).padStart(2, '0');
      const dd = String(lastDay).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }

  // 2. Try MM/YY or MM.YY
  const mmyyMatch = trimmed.match(/^(\d{1,2})[./\-](\d{2})$/);
  if (mmyyMatch) {
    const month = parseInt(mmyyMatch[1], 10);
    const shortYear = parseInt(mmyyMatch[2], 10);
    const year = 2000 + shortYear;
    if (month >= 1 && month <= 12) {
      const lastDay = getDaysInMonth(year, month);
      const mm = String(month).padStart(2, '0');
      const dd = String(lastDay).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }

  // 3. Try YYYY-MM
  const yyyymmMatch = trimmed.match(/^(\d{4})[./\-](\d{1,2})$/);
  if (yyyymmMatch) {
    const year = parseInt(yyyymmMatch[1], 10);
    const month = parseInt(yyyymmMatch[2], 10);
    if (month >= 1 && month <= 12 && year >= 1900 && year <= 2150) {
      const lastDay = getDaysInMonth(year, month);
      const mm = String(month).padStart(2, '0');
      const dd = String(lastDay).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }

  return null;
}

/**
 * Validates whether an expiration date is well-formed and inside acceptable range:
 * Range rule: "сегодня − 1 год … сегодня + 10 лет".
 */
export function validateExpirationDate(
  dateIso: string,
  now: Date
): { isValid: boolean; error?: string } {
  if (!dateIso || typeof dateIso !== 'string') {
    return { isValid: false, error: 'Дата не указана' };
  }

  const match = dateIso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { isValid: false, error: 'Неверный формат даты (ожидается ГГГГ-ММ-ДД)' };
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) {
    return { isValid: false, error: 'Недопустимый месяц (1-12)' };
  }

  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    return { isValid: false, error: `В этом месяце только ${maxDays} дней` };
  }

  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  const minYear = now.getUTCFullYear() - 1;
  const minDate = new Date(Date.UTC(minYear, now.getUTCMonth(), now.getUTCDate()));

  const maxYear = now.getUTCFullYear() + 10;
  const maxDate = new Date(Date.UTC(maxYear, now.getUTCMonth(), now.getUTCDate()));

  if (parsedDate < minDate) {
    return {
      isValid: false,
      error: 'Срок годности слишком старый (более 1 года назад)',
    };
  }

  if (parsedDate > maxDate) {
    return {
      isValid: false,
      error: 'Срок годности превышает допустимый лимит (более 10 лет вперед)',
    };
  }

  return { isValid: true };
}
