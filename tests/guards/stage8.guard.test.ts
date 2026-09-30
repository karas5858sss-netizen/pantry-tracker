import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseOcrDateCandidates, preprocessCanvasForOcr } from '../../shared/ocr.ts';
import { translations } from '../../shared/i18n.ts';

describe('Этап 8 (опционально). OCR даты: Guard and Acceptance Tests', () => {
  const rootDir = process.cwd();

  describe('Local Self-Hosted Tesseract Assets (Zero CDN Dependency)', () => {
    it('verifies that worker, wasm core, and language data files are self-hosted in public/tesseract/', () => {
      const tesseractDir = path.join(rootDir, 'public/tesseract');
      expect(fs.existsSync(tesseractDir)).toBe(true);

      const workerPath = path.join(tesseractDir, 'worker.min.js');
      expect(fs.existsSync(workerPath)).toBe(true);
      expect(fs.statSync(workerPath).size).toBeGreaterThan(10000);

      const coreWasmPath = path.join(tesseractDir, 'tesseract-core-lstm.wasm');
      expect(fs.existsSync(coreWasmPath)).toBe(true);
      expect(fs.statSync(coreWasmPath).size).toBeGreaterThan(100000);

      const engPath = path.join(tesseractDir, 'eng.traineddata.gz');
      expect(fs.existsSync(engPath)).toBe(true);
      expect(fs.statSync(engPath).size).toBeGreaterThan(1000000); // ~1.9 MB

      const rusPath = path.join(tesseractDir, 'rus.traineddata.gz');
      expect(fs.existsSync(rusPath)).toBe(true);
      expect(fs.statSync(rusPath).size).toBeGreaterThan(5000000); // ~8.2 MB

      const spaPath = path.join(tesseractDir, 'spa.traineddata.gz');
      expect(fs.existsSync(spaPath)).toBe(true);
      expect(fs.statSync(spaPath).size).toBeGreaterThan(5000000); // ~8.0 MB
    });

    it('ensures no CDN URLs for tesseract exist in client code', () => {
      const ocrReaderCode = fs.readFileSync(path.join(rootDir, 'src/ocrReader.ts'), 'utf-8');
      expect(ocrReaderCode).not.toContain('cdn.jsdelivr.net');
      expect(ocrReaderCode).not.toContain('unpkg.com');
      expect(ocrReaderCode).toContain('/tesseract/worker.min.js');
      expect(ocrReaderCode).toContain('/tesseract/tesseract-core-lstm.wasm.js');
      expect(ocrReaderCode).toContain("langPath: '/tesseract'");
    });
  });

  describe('Pure OCR Candidate Parsing and Month-End Clamping', () => {
    const fixedNow = new Date('2026-10-01T12:00:00Z');

    it('correctly parses candidate dates from complex multi-line text', () => {
      const sample = `
        SUPERMARKET MILK
        PROD: 10.09.2026
        EXP: 15.10.2026
        BATCH #8849-C
      `;
      const candidates = parseOcrDateCandidates(sample, fixedNow);
      expect(candidates).toHaveLength(2);
      expect(candidates[0].date).toBe('2026-09-10');
      expect(candidates[1].date).toBe('2026-10-15');
    });

    it('clamps MM.YYYY to the last day of the month (including leap years)', () => {
      // Leap year Feb 2028: 2028-02-29
      const feb2028 = parseOcrDateCandidates('BEST BEFORE 02/2028', fixedNow);
      expect(feb2028).toHaveLength(1);
      expect(feb2028[0].date).toBe('2028-02-29');

      // 30-day month April 2027: 2027-04-30
      const apr2027 = parseOcrDateCandidates('EXP 04.2027', fixedNow);
      expect(apr2027).toHaveLength(1);
      expect(apr2027[0].date).toBe('2027-04-30');
    });

    it('clamps textual month without day to the end of the month', () => {
      const oct2026 = parseOcrDateCandidates('CAD: OCT 2026', fixedNow);
      expect(oct2026).toHaveLength(1);
      expect(oct2026[0].date).toBe('2026-10-31');

      const dic2026 = parseOcrDateCandidates('CAD: DIC 2026', fixedNow);
      expect(dic2026).toHaveLength(1);
      expect(dic2026[0].date).toBe('2026-12-31');
    });

    it('filters out candidates outside the valid [now - 1y ... now + 10y] window', () => {
      const sample = 'Dates: 10.05.2015, 01.01.2026, 15.08.2045';
      const candidates = parseOcrDateCandidates(sample, fixedNow);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].date).toBe('2026-01-01');
    });
  });

  describe('Canvas Preprocessing Logic', () => {
    it('defines preprocessCanvasForOcr function for cropping and contrast boosting', () => {
      expect(typeof preprocessCanvasForOcr).toBe('function');
    });
  });

  describe('Localization & Component Verification', () => {
    it('ensures all ocr_* translation keys exist across ru, es, en', () => {
      const ocrKeys = [
        'ocr_scan_btn',
        'ocr_modal_title',
        'ocr_photo_prompt',
        'ocr_candidates_title',
        'ocr_no_candidates',
        'ocr_confirm_btn',
        'ocr_processing',
        'ocr_select_hint',
        'ocr_camera_btn',
        'ocr_gallery_btn',
      ] as const;

      for (const key of ocrKeys) {
        expect(translations.ru[key]).toBeDefined();
        expect(translations.es[key]).toBeDefined();
        expect(translations.en[key]).toBeDefined();
      }
    });

    it('verifies OcrDateScannerModal and ProductCardModal integration', () => {
      const modalPath = path.join(rootDir, 'src/components/OcrDateScannerModal.tsx');
      expect(fs.existsSync(modalPath)).toBe(true);

      const productCardCode = fs.readFileSync(path.join(rootDir, 'src/components/ProductCardModal.tsx'), 'utf-8');
      expect(productCardCode).toContain('OcrDateScannerModal');
      expect(productCardCode).toContain('ocr_scan_btn');
      expect(productCardCode).toContain('isOcrOpen');
    });
  });
});
