/**
 * Pure EAN-13 and EAN-8 checksum and validation utilities.
 * Compliant with GS1 standard specifications.
 * Works in browser, Node.js, Vitest, and Deno environments.
 */

export type EanType = 'EAN-13' | 'EAN-8';

export interface EanValidationResult {
  isValid: boolean;
  error?: string;
  normalized?: string;
  type?: EanType;
  expectedCheckDigit?: number;
  actualCheckDigit?: number;
}

/**
 * Removes spaces, hyphens, and standard barcode separator characters.
 */
export function cleanBarcode(input: string): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/[\s\-_]/g, '');
}

/**
 * Calculates the standard GS1 Modulo-10 check digit for a numeric payload.
 *
 * Algorithm:
 * - Starting from the rightmost digit of the payload (excluding check digit),
 *   alternate weights 3, 1, 3, 1... moving leftwards.
 * - Multiply each digit by its weight and sum them up.
 * - Check digit = (10 - (Sum % 10)) % 10.
 *
 * Examples:
 * - For 12-digit EAN-13 payload (index 0 to 11):
 *   odd positions from right have weight 3, even have weight 1.
 * - For 7-digit EAN-8 payload (index 0 to 6):
 *   odd positions from right have weight 3, even have weight 1.
 */
export function calculateEanCheckDigit(payload: string): number | null {
  const cleaned = cleanBarcode(payload);
  if (!cleaned || !/^\d+$/.test(cleaned)) {
    return null;
  }

  let sum = 0;
  let weight = 3;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    const digit = Number(cleaned[i]);
    sum += digit * weight;
    weight = weight === 3 ? 1 : 3;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * Validates whether a given string is a valid EAN-13 barcode.
 */
export function isValidEan13(barcode: string): boolean {
  const cleaned = cleanBarcode(barcode);
  if (!/^\d{13}$/.test(cleaned)) {
    return false;
  }

  const payload = cleaned.slice(0, 12);
  const actualCheckDigit = Number(cleaned[12]);
  const expectedCheckDigit = calculateEanCheckDigit(payload);

  return expectedCheckDigit !== null && actualCheckDigit === expectedCheckDigit;
}

/**
 * Validates whether a given string is a valid EAN-8 barcode.
 */
export function isValidEan8(barcode: string): boolean {
  const cleaned = cleanBarcode(barcode);
  if (!/^\d{8}$/.test(cleaned)) {
    return false;
  }

  const payload = cleaned.slice(0, 7);
  const actualCheckDigit = Number(cleaned[7]);
  const expectedCheckDigit = calculateEanCheckDigit(payload);

  return expectedCheckDigit !== null && actualCheckDigit === expectedCheckDigit;
}

/**
 * Checks if a string is a valid EAN-13 or EAN-8 barcode.
 */
export function isValidEan(barcode: string): boolean {
  return isValidEan13(barcode) || isValidEan8(barcode);
}

/**
 * Provides comprehensive validation and user-friendly error messages
 * for barcode inputs.
 */
export function validateEanInput(input: string): EanValidationResult {
  const cleaned = cleanBarcode(input);

  if (!cleaned) {
    return {
      isValid: false,
      error: 'Введите штрихкод',
    };
  }

  if (!/^\d+$/.test(cleaned)) {
    return {
      isValid: false,
      error: 'Штрихкод должен содержать только цифры',
    };
  }

  if (cleaned.length !== 8 && cleaned.length !== 13) {
    return {
      isValid: false,
      error: `Неверная длина (${cleaned.length} цифр). Должно быть 8 (EAN-8) или 13 (EAN-13)`,
    };
  }

  const is8 = cleaned.length === 8;
  const type: EanType = is8 ? 'EAN-8' : 'EAN-13';
  const payload = cleaned.slice(0, cleaned.length - 1);
  const actualCheckDigit = Number(cleaned[cleaned.length - 1]);
  const expectedCheckDigit = calculateEanCheckDigit(payload);

  if (expectedCheckDigit !== actualCheckDigit) {
    return {
      isValid: false,
      error: `Неверная контрольная цифра (получено ${actualCheckDigit}, ожидалось ${expectedCheckDigit})`,
      normalized: cleaned,
      type,
      actualCheckDigit,
      expectedCheckDigit: expectedCheckDigit ?? undefined,
    };
  }

  return {
    isValid: true,
    normalized: cleaned,
    type,
    actualCheckDigit,
    expectedCheckDigit,
  };
}
