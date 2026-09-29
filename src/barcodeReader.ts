import {
  readBarcodes,
  setZXingModuleOverrides,
  type ReadResult,
} from 'zxing-wasm/reader';
import { isValidEan } from '@shared/ean.ts';

// Configure zxing-wasm to load its WASM binary from local assets (/wasm/zxing_reader.wasm)
let initialized = false;

export function initBarcodeReader() {
  if (initialized) return;
  try {
    setZXingModuleOverrides({
      locateFile: (path: string, scriptDir: string) => {
        if (path.includes('zxing_reader.wasm')) {
          return '/wasm/zxing_reader.wasm';
        }
        return scriptDir + path;
      },
    });
    initialized = true;
  } catch (err) {
    console.warn('ZXing module override error:', err);
  }
}

export interface BarcodeDetection {
  text: string;
  format: string;
  isValidEan: boolean;
  timestamp: number;
}

export async function decodeFromCanvas(canvas: HTMLCanvasElement): Promise<BarcodeDetection | null> {
  initBarcodeReader();
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || canvas.width === 0 || canvas.height === 0) {
      return null;
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const results: ReadResult[] = await readBarcodes(imageData, {
      formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    });

    if (results && results.length > 0) {
      const match = results[0];
      return {
        text: match.text,
        format: match.format,
        isValidEan: isValidEan(match.text),
        timestamp: Date.now(),
      };
    }
    return null;
  } catch (err) {
    console.error('Barcode decode error from canvas:', err);
    return null;
  }
}

export async function decodeFromFile(file: File | Blob): Promise<BarcodeDetection | null> {
  initBarcodeReader();
  try {
    const results: ReadResult[] = await readBarcodes(file, {
      formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    });

    if (results && results.length > 0) {
      const match = results[0];
      return {
        text: match.text,
        format: match.format,
        isValidEan: isValidEan(match.text),
        timestamp: Date.now(),
      };
    }
    return null;
  } catch (err) {
    console.error('Barcode decode error from file:', err);
    return null;
  }
}
