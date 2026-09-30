/**
 * Client-side OCR date reader using self-hosted local Tesseract.js assets.
 * No external CDN calls: worker, core, and traineddata are loaded from /tesseract/.
 */

import { createWorker } from 'tesseract.js';
import { parseOcrDateCandidates, preprocessCanvasForOcr, type DateCandidate } from '@shared/ocr.ts';

export interface OcrScanResult {
  rawText: string;
  candidates: DateCandidate[];
}

/**
 * Recognizes date from an HTMLCanvasElement (cropped and preprocessed for contrast).
 */
export async function recognizeDateFromCanvas(
  canvas: HTMLCanvasElement,
  cropRect?: { x: number; y: number; width: number; height: number },
  onProgress?: (progress: number, status: string) => void
): Promise<OcrScanResult> {
  const preprocessedCanvas = preprocessCanvasForOcr(canvas, cropRect);

  onProgress?.(0.1, 'Инициализация OCR...');

  const worker = await createWorker('eng', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/tesseract-core-lstm.wasm.js',
    langPath: '/tesseract',
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(0.2 + m.progress * 0.7, 'Распознавание даты...');
      }
    },
  });

  try {
    // Restrict charset to digits, separators and standard month letters
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789./- :ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя',
    });

    onProgress?.(0.4, 'Чтение изображения...');
    const result = await worker.recognize(preprocessedCanvas);

    const rawText = result.data.text || '';
    const now = new Date();
    const candidates = parseOcrDateCandidates(rawText, now);

    onProgress?.(1.0, 'Готово');
    return { rawText, candidates };
  } finally {
    await worker.terminate();
  }
}

/**
 * Recognizes date from a photo file/blob (from gallery or camera snapshot).
 */
export async function recognizeDateFromFile(
  file: File | Blob,
  cropRect?: { x: number; y: number; width: number; height: number },
  onProgress?: (progress: number, status: string) => void
): Promise<OcrScanResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image file'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context not available');
    }
    ctx.drawImage(img, 0, 0);

    return await recognizeDateFromCanvas(canvas, cropRect, onProgress);
  } finally {
    URL.revokeObjectURL(url);
  }
}
