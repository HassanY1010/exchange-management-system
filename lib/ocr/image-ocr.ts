import { createWorker, Worker } from 'tesseract.js';
import path from 'path';
import fs from 'fs';
import { parseBankakReceiptText, computeImageHash, ParsedBankakReceipt } from './bankak-parser';

export interface OcrProcessingResult {
  parsed: ParsedBankakReceipt;
  imageHash: string;
  rawText: string;
  engineUsed: 'tesseract' | 'heuristic_parser';
  durationMs: number;
}

/**
 * Robust Singleton Worker Manager for Tesseract.js
 * Prevents recreating the worker on each request, eliminates redundant language downloads,
 * provides mutex serialization for thread safety, and enforces a strict timeout guard.
 */
class OcrWorkerManager {
  private worker: Worker | null = null;
  private initPromise: Promise<Worker> | null = null;
  private queue: Promise<any> = Promise.resolve();

  private getLangPath(): string {
    const localTessdata = path.join(process.cwd(), 'lib', 'ocr', 'tessdata');
    if (fs.existsSync(path.join(localTessdata, 'ara.traineddata'))) {
      return localTessdata;
    }
    return 'https://tessdata.projectnaptha.com/4.0.0_fast';
  }

  public async getWorker(): Promise<Worker> {
    if (this.worker) return this.worker;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const startTime = Date.now();
      const langPath = this.getLangPath();

      const cacheDir = path.join(process.cwd(), '.tesseract_cache');
      if (!fs.existsSync(cacheDir)) {
        try {
          fs.mkdirSync(cacheDir, { recursive: true });
        } catch (e) {}
      }

      const options: any = {
        langPath,
        cachePath: cacheDir,
        gzip: false,
        errorHandler: (err: any) => console.warn('[OCR Worker Notice]:', err),
      };

      // Explicitly provide workerPath so Webpack does not resolve relative to .next/server/app/api/v1/
      const localWorkerScript = path.join(
        process.cwd(),
        'node_modules',
        'tesseract.js',
        'src',
        'worker-script',
        'node',
        'index.js'
      );
      if (fs.existsSync(localWorkerScript)) {
        options.workerPath = localWorkerScript;
      }

      const w = await createWorker(['ara', 'eng'], 1, options);
      try {
        await w.setParameters({ tessedit_pageseg_mode: '4' as any });
      } catch (paramErr) {
        console.warn('[OCR Worker] PSM 4 setParameters notice:', paramErr);
      }

      this.worker = w;
      return w;
    })();

    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  public async recognizeWithTimeout(imageInput: Buffer, timeoutMs = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.catch(() => {}).then(async () => {
        let timer: NodeJS.Timeout | null = null;
        try {
          const worker = await this.getWorker();

          const timeoutPromise = new Promise<never>((_, rej) => {
            timer = setTimeout(() => {
              rej(new Error(`OCR recognition timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          });

          const recognizePromise = worker.recognize(imageInput).then((res) => res.data.text || '');

          const text = await Promise.race([recognizePromise, timeoutPromise]);
          resolve(text);
        } catch (err: any) {
          // If timed out or crashed, recycle worker safely
          await this.recycleWorker();
          reject(err);
        } finally {
          if (timer) clearTimeout(timer);
        }
      });
    });
  }

  public async recycleWorker(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (e) {}
      this.worker = null;
    }
  }
}

// Global singleton instance across Next.js reloads
const globalForOcr = globalThis as unknown as {
  ocrWorkerManager?: OcrWorkerManager;
};

export const ocrWorkerManager = globalForOcr.ocrWorkerManager || new OcrWorkerManager();
if (process.env.NODE_ENV !== 'production') {
  globalForOcr.ocrWorkerManager = ocrWorkerManager;
}

/**
 * Pre-warms the OCR worker (safe background warm-up)
 */
export async function warmupOcrWorker(): Promise<void> {
  try {
    await ocrWorkerManager.getWorker();
  } catch (err: any) {
    console.warn('[OCR Warmup Notice]:', err.message);
  }
}

/**
 * Optical Character Recognition Engine
 * Performs real pixel-level OCR on image buffers or base64 image data using persistent Tesseract.js worker,
 * extracting Arabic and Latin characters and feeding them into the Bankak transaction parser.
 */
export async function processReceiptImageWithOcr(
  imageBufferOrBase64: Buffer | string,
  preExtractedText?: string
): Promise<OcrProcessingResult> {
  const startTime = Date.now();
  const imageHash = computeImageHash(imageBufferOrBase64);

  // If pre-extracted text is supplied (e.g. from mobile SDK or high-speed scanner), use it directly
  if (preExtractedText && preExtractedText.trim().length > 15) {
    const parsed = parseBankakReceiptText(preExtractedText);
    return {
      parsed,
      imageHash,
      rawText: preExtractedText,
      engineUsed: 'heuristic_parser',
      durationMs: Date.now() - startTime,
    };
  }

  // If input is a synthetic string or not a valid data URL/Buffer, skip Tesseract worker
  const isDataUrl = typeof imageBufferOrBase64 === 'string' && imageBufferOrBase64.startsWith('data:image');
  const isBuffer = Buffer.isBuffer(imageBufferOrBase64);
  if (!isDataUrl && !isBuffer) {
    const parsed = parseBankakReceiptText(typeof imageBufferOrBase64 === 'string' ? imageBufferOrBase64 : '');
    return {
      parsed,
      imageHash,
      rawText: typeof imageBufferOrBase64 === 'string' ? imageBufferOrBase64 : '',
      engineUsed: 'heuristic_parser',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    let imageInput: Buffer;
    if (typeof imageBufferOrBase64 === 'string') {
      const base64Data = imageBufferOrBase64.replace(/^data:image\/[a-zA-Z0-9\-\+\.]+;base64,/, '');
      imageInput = Buffer.from(base64Data, 'base64');
    } else {
      imageInput = imageBufferOrBase64;
    }

    // Recognize with 15-second strict timeout guard to prevent infinite hanging
    const rawText = await ocrWorkerManager.recognizeWithTimeout(imageInput, 15000);
    const parsed = parseBankakReceiptText(rawText);

    return {
      parsed,
      imageHash,
      rawText,
      engineUsed: 'tesseract',
      durationMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.warn('[OCR Fallback Notice]:', error?.message || error);
    const parsed = parseBankakReceiptText(typeof imageBufferOrBase64 === 'string' ? imageBufferOrBase64 : '');
    return {
      parsed,
      imageHash,
      rawText: '',
      engineUsed: 'heuristic_parser',
      durationMs: Date.now() - startTime,
    };
  }
}
