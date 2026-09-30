import { describe, it, expect } from 'vitest';
import { parseOcrDateCandidates } from '../../shared/ocr.ts';

describe('Этап 8 (опционально). OCR даты: Pure candidate parsing and validation', () => {
  // Reference date: 2026-10-01
  const referenceNow = new Date('2026-10-01T12:00:00Z');

  describe('Format 1: DD.MM.YYYY and variations', () => {
    it('parses dot, slash, hyphen and space separated standard DD.MM.YYYY dates', () => {
      const text1 = 'BEST BEFORE: 15.10.2026 LOT 449B';
      const res1 = parseOcrDateCandidates(text1, referenceNow);
      expect(res1).toHaveLength(1);
      expect(res1[0].date).toBe('2026-10-15');
      expect(res1[0].format).toBe('DD.MM.YYYY');

      const text2 = 'EXP: 25/12/2026';
      const res2 = parseOcrDateCandidates(text2, referenceNow);
      expect(res2[0].date).toBe('2026-12-25');

      const text3 = 'CAD 04-07-2027';
      const res3 = parseOcrDateCandidates(text3, referenceNow);
      expect(res3[0].date).toBe('2027-07-04');
    });

    it('handles leap year 29.02.2028 correctly', () => {
      const text = 'EXP 29.02.2028';
      const res = parseOcrDateCandidates(text, referenceNow);
      expect(res[0].date).toBe('2028-02-29');

      // Invalid leap year: 29.02.2027 should be discarded
      const invalidText = 'EXP 29.02.2027';
      expect(parseOcrDateCandidates(invalidText, referenceNow)).toHaveLength(0);
    });
  });

  describe('Format 2: DD.MM.YY (2-digit year)', () => {
    it('expands 2-digit year to 20YY', () => {
      const text = 'BBE 20.08.27 L123';
      const res = parseOcrDateCandidates(text, referenceNow);
      expect(res).toHaveLength(1);
      expect(res[0].date).toBe('2027-08-20');
      expect(res[0].format).toBe('DD.MM.YY');
    });
  });

  describe('Format 3: MM.YYYY (Month and 4-digit Year only)', () => {
    it('parses MM.YYYY and clamps to the last day of the month', () => {
      // October 2026 -> 2026-10-31
      const text1 = 'CONSUMIR PREFERENTEMENTE ANTES DE 10.2026';
      const res1 = parseOcrDateCandidates(text1, referenceNow);
      expect(res1).toHaveLength(1);
      expect(res1[0].date).toBe('2026-10-31');
      expect(res1[0].format).toBe('MM.YYYY');

      // February 2028 (leap year) -> 2028-02-29
      const text2 = 'EXP 02/2028';
      const res2 = parseOcrDateCandidates(text2, referenceNow);
      expect(res2[0].date).toBe('2028-02-29');

      // November 2026 (30 days) -> 2026-11-30
      const text3 = 'BEST BEFORE: 11-2026';
      const res3 = parseOcrDateCandidates(text3, referenceNow);
      expect(res3[0].date).toBe('2026-11-30');
    });
  });

  describe('Format 4: Textual Month abbreviations (EN, ES, RU)', () => {
    it('parses English abbreviations: 12 OCT 2026', () => {
      const text = 'PROD 10 SEP 2026 EXP 12 OCT 2026';
      const res = parseOcrDateCandidates(text, referenceNow);
      expect(res).toHaveLength(2);
      expect(res[0].date).toBe('2026-09-10');
      expect(res[1].date).toBe('2026-10-12');
      expect(res[0].format).toBe('TEXT_MONTH');
    });

    it('parses Spanish abbreviations: ENE, ABR, AGO, DIC', () => {
      const textEne = 'CAD: 15 ENE 2027';
      expect(parseOcrDateCandidates(textEne, referenceNow)[0].date).toBe('2027-01-15');

      const textAbr = 'FECHA CADUCIDAD: 20 ABR 2028';
      expect(parseOcrDateCandidates(textAbr, referenceNow)[0].date).toBe('2028-04-20');

      const textAgo = 'LOTE 55 10 AGO 2027';
      expect(parseOcrDateCandidates(textAgo, referenceNow)[0].date).toBe('2027-08-10');

      const textDic = 'CONSUMO: 31 DIC 2026';
      expect(parseOcrDateCandidates(textDic, referenceNow)[0].date).toBe('2026-12-31');
    });

    it('parses textual month only (e.g. OCT 2026) clamped to month end', () => {
      const text = 'CADUCIDAD: OCT 2026';
      const res = parseOcrDateCandidates(text, referenceNow);
      expect(res).toHaveLength(1);
      expect(res[0].date).toBe('2026-10-31');
    });

    it('parses Russian month abbreviations: 15 ОКТ 2026', () => {
      const text = 'ГОДЕН ДО: 15 ОКТ 2026';
      const res = parseOcrDateCandidates(text, referenceNow);
      expect(res).toHaveLength(1);
      expect(res[0].date).toBe('2026-10-15');
    });
  });

  describe('Range Filtering (сегодня − 1 год … сегодня + 10 лет)', () => {
    it('discards dates older than 1 year or farther than 10 years', () => {
      // referenceNow is 2026-10-01
      // Past within 1 year: 2026-01-15 (OK)
      // Past > 1 year: 2024-05-10 (Discarded)
      // Future > 10 years: 2040-01-01 (Discarded)
      const text = 'DATES: 15.01.2026 and 10.05.2024 and 01.01.2040';
      const res = parseOcrDateCandidates(text, referenceNow);

      expect(res).toHaveLength(1);
      expect(res[0].date).toBe('2026-01-15');
    });

    it('discards invalid calendar dates (e.g. 31.04.2026)', () => {
      const text = 'EXP 31.04.2026'; // April has 30 days!
      const res = parseOcrDateCandidates(text, referenceNow);
      expect(res).toHaveLength(0);
    });

    it('handles empty or malformed strings gracefully', () => {
      expect(parseOcrDateCandidates('', referenceNow)).toEqual([]);
      expect(parseOcrDateCandidates('NO DATE HERE', referenceNow)).toEqual([]);
    });
  });
});
