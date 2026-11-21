import { createWorker } from 'tesseract.js';
import { parseBankakReceiptText, computeImageHash, ParsedBankakReceipt } from './bankak-parser';

export interface OcrProcessingResult {
  parsed: ParsedBankakReceipt;
  imageHash: string;
  rawText: string;
  engineUsed: 'tesseract' | 'heuristic_parser';
  durationMs: number;
}

/**
 * Optical Character Recognition Engine
 * Performs real pixel-level OCR on image buffers or base64 image data using Tesseract.js,
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
    // Initialize Tesseract OCR worker with Arabic and English
    const worker = await createWorker(['ara', 'eng'], 1, {
      errorHandler: (err) => console.warn('Tesseract warning:', err),
    });

    let imageInput: Buffer | string = imageBufferOrBase64;
    if (typeof imageBufferOrBase64 === 'string' && imageBufferOrBase64.startsWith('data:image')) {
      // Extract base64 part
      const base64Data = imageBufferOrBase64.replace(/^data:image\/\w+;base64,/, '');
      imageInput = Buffer.from(base64Data, 'base64');
    }

    const ret = await worker.recognize(imageInput);
    await worker.terminate();

    const rawText = ret.data.text || '';
    const parsed = parseBankakReceiptText(rawText);

    return {
      parsed,
      imageHash,
      rawText,
      engineUsed: 'tesseract',
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    console.warn('Fallback to heuristic text parser due to OCR worker environment:', error);
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
