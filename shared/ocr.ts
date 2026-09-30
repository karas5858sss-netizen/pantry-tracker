/**
 * Pure domain logic for parsing OCR text and extracting candidate expiration dates.
 * Supports formats:
 * - DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY
 * - DD.MM.YY / DD/MM/YY / DD-MM-YY
 * - MM.YYYY / MM/YYYY / MM-YYYY (end-of-month clamping)
 * - Textual months: '12 OCT 2026', '15 ENE 2027', '31 DIC 2026', '12 ОКТ 2026'
 * Filters candidates to valid window: "сегодня − 1 год … сегодня + 10 лет".
 */

import { getDaysInMonth, validateExpirationDate } from './expiration.ts';

export interface DateCandidate {
  date: string; // YYYY-MM-DD
  rawMatch: string;
  format: 'DD.MM.YYYY' | 'DD.MM.YY' | 'MM.YYYY' | 'TEXT_MONTH';
}

const MONTH_MAP: Record<string, number> = {
  // English
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  // Spanish
  ene: 1,
  abr: 4,
  ago: 8,
  set: 9,
  dic: 12,
  // Russian
  янв: 1,
  фев: 2,
  мар: 3,
  апр: 4,
  май: 5,
  июн: 6,
  июл: 7,
  авг: 8,
  сен: 9,
  окт: 10,
  ноя: 11,
  дек: 12,
};

/**
 * Extracts candidate expiration dates from raw OCR text.
 * Deterministic: accepts `now: Date` parameter for range filtering.
 */
export function parseOcrDateCandidates(ocrText: string, now: Date): DateCandidate[] {
  if (!ocrText || typeof ocrText !== 'string') {
    return [];
  }

  // Work with a mutable character buffer to mask consumed matches
  let text = ocrText.replace(/[\r\n]+/g, ' ');
  const candidates: DateCandidate[] = [];
  const seenDates = new Set<string>();

  const maskMatched = (start: number, length: number) => {
    const spaces = ' '.repeat(length);
    text = text.substring(0, start) + spaces + text.substring(start + length);
  };

  const addIfValid = (
    year: number,
    month: number,
    day: number,
    rawMatch: string,
    format: DateCandidate['format']
  ): boolean => {
    if (month < 1 || month > 12) return false;
    const maxDay = getDaysInMonth(year, month);
    if (day < 1 || day > maxDay) return false;

    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (seenDates.has(iso)) return true;

    const validation = validateExpirationDate(iso, now);
    if (validation.isValid) {
      seenDates.add(iso);
      candidates.push({
        date: iso,
        rawMatch,
        format,
      });
      return true;
    }
    return false;
  };

  // 1. Full Textual Month with Day: e.g. "12 OCT 2026", "15 ENE 2027", "31 DIC 26", "10 ОКТ 2026"
  const textMonthRegex = /\b(0?[1-9]|[12]\d|3[01])[\s\.\/\-]+([A-Za-zА-Яа-яЁё]{3,4})[\s\.\/\-]+(20\d{2}|\d{2})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = textMonthRegex.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const mStr = match[2].toLowerCase();
    const month = MONTH_MAP[mStr];
    let year = parseInt(match[3], 10);
    if (year < 100) year += 2000;

    if (month) {
      addIfValid(year, month, day, match[0].trim(), 'TEXT_MONTH');
    }
    maskMatched(match.index, match[0].length);
  }

  // 2. Full DD.MM.YYYY (4-digit year): e.g. "15.10.2026", "15/10/2026", "15-10-2026"
  // Note: lookahead/lookbehind ensures we don't match partial numbers
  const ddmmyyyyRegex = /(?<![\d\.\/\-])(0?[1-9]|[12]\d|3[01])[\.\/\-\s](0?[1-9]|1[0-2])[\.\/\-\s](20\d{2})(?![\d\.\/\-])/g;
  while ((match = ddmmyyyyRegex.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    addIfValid(year, month, day, match[0].trim(), 'DD.MM.YYYY');
    maskMatched(match.index, match[0].length);
  }

  // 3. DD.MM.YY (2-digit year): e.g. "15.10.26", "15/10/26", "15-10-26"
  const ddmmyyRegex = /(?<![\d\.\/\-])(0?[1-9]|[12]\d|3[01])[\.\/\-\s](0?[1-9]|1[0-2])[\.\/\-\s](\d{2})(?![\d\.\/\-])/g;
  while ((match = ddmmyyRegex.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = 2000 + parseInt(match[3], 10);
    addIfValid(year, month, day, match[0].trim(), 'DD.MM.YY');
    maskMatched(match.index, match[0].length);
  }

  // 4. Textual Month without Day (e.g. "OCT 2026", "ENE 2027", "DIC 2026") -> last day of month
  const textMonthOnlyRegex = /(?<![\d\.\/\-])([A-Za-zА-Яа-яЁё]{3,4})[\s\.\/\-]+(20\d{2})(?![\d\.\/\-])/gi;
  while ((match = textMonthOnlyRegex.exec(text)) !== null) {
    const mStr = match[1].toLowerCase();
    const month = MONTH_MAP[mStr];
    const year = parseInt(match[2], 10);
    if (month) {
      const lastDay = getDaysInMonth(year, month);
      addIfValid(year, month, lastDay, match[0].trim(), 'TEXT_MONTH');
    }
    maskMatched(match.index, match[0].length);
  }

  // 5. MM.YYYY (only 4-digit year, month 1..12, NOT part of DD.MM.YYYY): e.g. "10.2026", "05/2027" -> last day of month
  const mmyyyyRegex = /(?<![\d\.\/\-])(0?[1-9]|1[0-2])[\.\/\-\s](20\d{2})(?![\d\.\/\-])/g;
  while ((match = mmyyyyRegex.exec(text)) !== null) {
    const month = parseInt(match[1], 10);
    const year = parseInt(match[2], 10);
    const lastDay = getDaysInMonth(year, month);
    addIfValid(year, month, lastDay, match[0].trim(), 'MM.YYYY');
    maskMatched(match.index, match[0].length);
  }

  // Sort candidates by date ascending (soonest first)
  candidates.sort((a, b) => a.date.localeCompare(b.date));

  return candidates;
}

/**
 * Preprocesses image on a canvas for OCR:
 * 1. Optional cropping to region of interest (viewfinder frame)
 * 2. Grayscale conversion
 * 3. Contrast enhancement
 */
export function preprocessCanvasForOcr(
  sourceCanvas: HTMLCanvasElement,
  cropRect?: { x: number; y: number; width: number; height: number }
): HTMLCanvasElement {
  const targetCanvas = document.createElement('canvas');
  const crop = cropRect || {
    x: 0,
    y: 0,
    width: sourceCanvas.width,
    height: sourceCanvas.height,
  };

  targetCanvas.width = crop.width;
  targetCanvas.height = crop.height;

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return targetCanvas;

  // Draw cropped region
  ctx.drawImage(
    sourceCanvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );

  const imgData = ctx.getImageData(0, 0, crop.width, crop.height);
  const data = imgData.data;

  // Convert to grayscale and apply contrast stretching
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    // High contrast thresholding: boost readability of printed dot-matrix/inkjet stamps
    const highContrast = gray > 140 ? 255 : Math.max(0, gray - 30);
    data[i] = highContrast;
    data[i + 1] = highContrast;
    data[i + 2] = highContrast;
  }

  ctx.putImageData(imgData, 0, 0);
  return targetCanvas;
}
