import { createWorker, Worker, Page } from 'tesseract.js';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import {
  parseBankakReceiptText,
  mergeParsedResults,
  computeImageHash,
  extractAmountRegionFromPage,
  extractBeneficiaryRegionFromPage,
  evaluateArabicNameCompleteness,
  isCleanArabicName,
  parseBankakAmount,
  AMOUNT_LABEL_REGEX,
  AMOUNT_LABEL_STRIP_REGEX,
  ParsedAmountResult,
  ParsedBankakReceipt,
  OcrPageData,
  OcrLineToken,
  OcrWordToken,
} from './bankak-parser';
import {
  preprocessReceiptImage,
  cropRegionForOcr,
  PreprocessedImageResult,
} from './image-preprocessor';

export interface OcrProcessingResult {
  parsed: ParsedBankakReceipt;
  imageHash: string;
  rawText: string;
  engineUsed: 'tesseract' | 'heuristic_parser';
  durationMs: number;
  diagnostics?: {
    tesseractConfidence: number;
    psmModesUsed: string[];
    preprocessingSteps: string[];
    roiVerified: boolean;
    warnings: string[];
  };
}

/**
 * Converts Tesseract.js Page output (with blocks) into structured OcrPageData
 * containing lines, words, bounding boxes, and real per-word/page confidence.
 */
function extractPageData(data: Page, psm: string): OcrPageData {
  const lines: OcrLineToken[] = [];
  if (Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const words: OcrWordToken[] = (line.words || []).map((w) => ({
            text: w.text || '',
            confidence: typeof w.confidence === 'number' ? w.confidence : 0,
            bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
          }));
          lines.push({
            text: line.text || '',
            confidence: typeof line.confidence === 'number' ? line.confidence : 0,
            bbox: line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
            words,
          });
        }
      }
    }
  }

  return {
    text: data.text || '',
    confidence: typeof data.confidence === 'number' ? data.confidence : 0,
    lines,
    psm,
  };
}

/**
 * Robust Singleton Worker Manager for Tesseract.js 7
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
      const langPath = this.getLangPath();

      const cacheDir = path.join(process.cwd(), '.tesseract_cache');
      if (!fs.existsSync(cacheDir)) {
        try {
          fs.mkdirSync(cacheDir, { recursive: true });
        } catch {}
      }

      const options: any = {
        langPath,
        cachePath: cacheDir,
        gzip: false,
        errorHandler: (err: any) => console.warn('[OCR Worker Notice]:', err),
      };

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
        await w.setParameters({
          tessedit_pageseg_mode: '4' as any,
        });
      } catch (paramErr) {
        console.warn('[OCR Worker] setParameters notice:', paramErr);
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

  public async recognizePageWithMode(
    imageInput: Buffer,
    psm = '4',
    timeoutMs = 15000
  ): Promise<OcrPageData> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue
        .catch(() => {})
        .then(async () => {
          let timer: NodeJS.Timeout | null = null;
          try {
            const worker = await this.getWorker();
            try {
              await worker.setParameters({
                tessedit_pageseg_mode: psm as any,
              });
            } catch {}

            const timeoutPromise = new Promise<never>((_, rej) => {
              timer = setTimeout(() => {
                rej(new Error(`OCR recognition timed out after ${timeoutMs}ms (PSM ${psm})`));
              }, timeoutMs);
            });

            const recognizePromise = worker
              .recognize(imageInput, {}, { text: true, blocks: true })
              .then((res) => extractPageData(res.data, psm));

            const pageData = await Promise.race([recognizePromise, timeoutPromise]);
            resolve(pageData);
          } catch (err: any) {
            await this.recycleWorker();
            reject(err);
          } finally {
            if (timer) clearTimeout(timer);
          }
        });
    });
  }

  public async recognizeWithMode(imageInput: Buffer, psm = '4', timeoutMs = 15000): Promise<string> {
    const page = await this.recognizePageWithMode(imageInput, psm, timeoutMs);
    return page.text;
  }

  public async recognizeWithTimeout(imageInput: Buffer, timeoutMs = 15000): Promise<string> {
    return this.recognizeWithMode(imageInput, '4', timeoutMs);
  }

  public async recycleWorker(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch {}
      this.worker = null;
    }
  }
}

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
 * Evaluates whether a Region-of-Interest (ROI) amount re-OCR result should replace
 * the primary extracted amount. Prevents overwriting a valid multi-digit/grouped amount
 * (e.g. 500,000) with a stray short token (e.g. 7) from an adjacent line.
 */
export function shouldAdoptRoiAmount(
  current: ParsedBankakReceipt,
  roiParsedAmount: ParsedAmountResult,
  roiPage: OcrPageData
): boolean {
  if (!roiParsedAmount.success || roiParsedAmount.isAmbiguous || roiParsedAmount.value <= 0) {
    return false;
  }

  if (!current.amountValid || current.amount <= 0) {
    return true;
  }

  if (roiParsedAmount.value === current.amount) {
    return false;
  }

  const currentDigits = String(Math.floor(current.amount)).length;
  const roiDigits = String(Math.floor(roiParsedAmount.value)).length;
  const currentHasGrouping = /[.,'\s]\d{3}/.test(current.amountParseResult?.originalText || '');
  const roiHasGrouping = /[.,'\s]\d{3}/.test(roiParsedAmount.originalText || '');
  const roiHasAmountLabel = AMOUNT_LABEL_REGEX.test(roiPage.text || '');

  // Never replace a valid multi-digit or grouped amount with a stray short token
  if (currentDigits >= 4 && roiDigits <= 2) {
    return false;
  }
  if (currentHasGrouping && !roiHasGrouping && roiDigits < currentDigits - 1) {
    return false;
  }

  const currentWordConf = current.amountConfidenceDetail?.wordConfidence ?? 0;
  const roiConf = Math.round(roiPage.confidence || 0);

  // Adopt ROI if it recovers a clearly higher-magnitude grouped amount (e.g. 220 -> 2,500,000)
  if (roiHasGrouping && !currentHasGrouping && roiDigits > currentDigits && roiConf >= currentWordConf) {
    return true;
  }

  // Or if ROI has explicit Amount label context, higher confidence, and comparable/higher digit count
  if (roiHasAmountLabel && roiConf >= currentWordConf + 10 && roiDigits >= currentDigits) {
    return true;
  }

  return false;
}

/**
 * Optical Character Recognition Engine
 * Performs Sharp preprocessing (EXIF rotate, smart scaling, contrast normalization),
 * multi-mode Tesseract.js recognition with bounding boxes & real confidence,
 * and Region-of-Interest (ROI) verification for amounts.
 */
export async function processReceiptImageWithOcr(
  imageBufferOrBase64: Buffer | string,
  preExtractedText?: string
): Promise<OcrProcessingResult> {
  const startTime = Date.now();
  const imageHash = computeImageHash(imageBufferOrBase64);

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

    const psmModesUsed: string[] = [];
    let roiVerified = false;

    // Step 1: Inspect & prepare EXIF-oriented clean buffer + preprocessed buffer
    const prep: PreprocessedImageResult = await preprocessReceiptImage(imageInput, {
      generateEnhanced: false,
    });

    // Pass 1: Primary recognition on original image buffer (preserves 100% crispness for digital screenshots) with PSM 4
    psmModesUsed.push('4-raw');
    const page1 = await ocrWorkerManager.recognizePageWithMode(imageInput, '4', 15000);
    let parsed = parseBankakReceiptText(page1.text, page1);
    let combinedRawText = page1.text;
    let bestPageForRoi = page1;
    const recognizedPages: OcrPageData[] = [page1];
    let roiSourceBuf = imageInput;
    let roiWidth = prep.metadata.width || prep.processedWidth;
    let roiHeight = prep.metadata.height || prep.processedHeight;

    // Pass 2: If any key field is missing or confidence is low, run PSM 11 on original buffer
    if (
      !parsed.amountValid ||
      !parsed.receiverNameValid ||
      !parsed.dateValid ||
      !parsed.transactionId ||
      page1.confidence < 65
    ) {
      try {
        psmModesUsed.push('11-raw');
        const page2 = await ocrWorkerManager.recognizePageWithMode(imageInput, '11', 12000);
        recognizedPages.push(page2);
        const parsed2 = parseBankakReceiptText(page2.text, page2);
        parsed = mergeParsedResults(parsed, parsed2);
        combinedRawText = `${combinedRawText}\n--- Secondary OCR (PSM 11) ---\n${page2.text}`;
        if (!bestPageForRoi.lines.length || page2.confidence > bestPageForRoi.confidence) {
          bestPageForRoi = page2;
        }
      } catch (err: any) {
        console.warn('[OCR Secondary Pass Notice]:', err?.message || err);
      }
    }

    // Pass 3: If still missing amount/txnId or low confidence (e.g., compressed/dim/low-res photo),
    // run Sharp-preprocessed buffer (grayscale + normalize + upscale + gentle sharpen) and compare
    if (
      (!parsed.amountValid || !parsed.transactionId || parsed.ocrConfidence < 75) &&
      prep.preprocessingApplied
    ) {
      try {
        psmModesUsed.push('4-preprocessed');
        const pagePrep = await ocrWorkerManager.recognizePageWithMode(prep.standardBuffer, '4', 12000);
        const parsedPrep = parseBankakReceiptText(pagePrep.text, pagePrep);
        parsed = mergeParsedResults(parsed, parsedPrep);
        combinedRawText = `${combinedRawText}\n--- Preprocessed OCR (PSM 4) ---\n${pagePrep.text}`;
        if (!bestPageForRoi.lines.length || pagePrep.confidence > bestPageForRoi.confidence) {
          bestPageForRoi = pagePrep;
          roiSourceBuf = prep.standardBuffer;
          roiWidth = prep.processedWidth;
          roiHeight = prep.processedHeight;
        }
      } catch (err: any) {
        console.warn('[OCR Preprocessed Pass Notice]:', err?.message || err);
      }
    }

    // Pass 4: Enhanced-contrast fallback with PSM 6 if amount is still invalid
    if (!parsed.amountValid && prep.preprocessingApplied) {
      try {
        const enhancedPrep = await preprocessReceiptImage(imageInput, { generateEnhanced: true });
        if (enhancedPrep.enhancedBuffer) {
          psmModesUsed.push('6-enhanced');
          const page3 = await ocrWorkerManager.recognizePageWithMode(enhancedPrep.enhancedBuffer, '6', 12000);
          const parsed3 = parseBankakReceiptText(page3.text, page3);
          parsed = mergeParsedResults(parsed, parsed3);
          combinedRawText = `${combinedRawText}\n--- Enhanced OCR (PSM 6) ---\n${page3.text}`;
          if (page3.confidence > bestPageForRoi.confidence) {
            bestPageForRoi = page3;
            roiSourceBuf = enhancedPrep.enhancedBuffer;
            roiWidth = enhancedPrep.processedWidth;
            roiHeight = enhancedPrep.processedHeight;
          }
        }
      } catch (err: any) {
        console.warn('[OCR Enhanced Pass Notice]:', err?.message || err);
      }
    }

    // Pass 5: Region-of-Interest (ROI) Amount Verification when amount is missing, low-confidence, or suspiciously small
    const shouldVerifyAmountRoi =
      roiWidth > 0 &&
      roiHeight > 0 &&
      (!parsed.amountValid ||
        (parsed.amountConfidenceDetail?.wordConfidence ?? 100) < 75 ||
        (parsed.amount > 0 && parsed.amount < 1000));

    if (shouldVerifyAmountRoi) {
      const region = extractAmountRegionFromPage(bestPageForRoi);
      if (region?.bandBbox) {
        const roiBuf = await cropRegionForOcr(
          roiSourceBuf,
          region.bandBbox,
          roiWidth,
          roiHeight,
          6,
          2
        );
        if (roiBuf) {
          try {
            psmModesUsed.push('6-roi');
            const roiPage = await ocrWorkerManager.recognizePageWithMode(roiBuf, '6', 8000);
            const roiClean = roiPage.text.replace(AMOUNT_LABEL_STRIP_REGEX, '');
            const roiParsedAmount = parseBankakAmount(roiClean, parsed.currency || 'SDG');
            if (roiParsedAmount.success && !roiParsedAmount.isAmbiguous) {
              roiVerified = true;
              const roiConf = Math.round(roiPage.confidence);
              if (shouldAdoptRoiAmount(parsed, roiParsedAmount, roiPage)) {
                parsed.amount = roiParsedAmount.value;
                parsed.amountValid = true;
                parsed.amountNeedsReview = false;
                parsed.amountParseResult = roiParsedAmount;
                parsed.amountConfidenceDetail = {
                  wordConfidence: roiConf,
                  separatorInterpretation: roiParsedAmount.separatorInterpretation,
                  rawToken: roiParsedAmount.originalText,
                  method: 'roi_reocr',
                };
              }
            }
          } catch (roiErr: any) {
            console.warn('[OCR ROI Pass Notice]:', roiErr?.message || roiErr);
          }
        }
      }
    }

    // Pass 6: Beneficiary Region-of-Interest (ROI) Verification when receiverName is missing, garbled, or partial
    if (
      roiWidth > 0 &&
      roiHeight > 0 &&
      (!parsed.receiverNameValid || parsed.receiverNameQuality !== 'full')
    ) {
      let benefRegion = extractBeneficiaryRegionFromPage(bestPageForRoi);
      if (!benefRegion) {
        for (const p of recognizedPages) {
          benefRegion = extractBeneficiaryRegionFromPage(p);
          if (benefRegion) break;
        }
      }
      if (benefRegion) {
        try {
          // Crop left 70% of the beneficiary band (excludes right-side "إسم المرسل إليه" label)
          const left = 0;
          const top = Math.max(0, Math.floor(benefRegion.y0 - 4));
          const width = Math.min(roiWidth, Math.round(roiWidth * 0.7));
          const height = Math.min(roiHeight - top, Math.ceil(benefRegion.y1 - top + 4));

          if (width >= 40 && height >= 14) {
            const benefRoiBuf = await sharp(roiSourceBuf, { failOn: 'none' })
              .extract({ left, top, width, height })
              .resize({ width: Math.min(1800, Math.round(width * 2.5)), kernel: sharp.kernel.lanczos3 })
              .grayscale()
              .normalize()
              .negate({ alpha: false }) // Convert white-on-green text to black-on-white for LSTM
              .sharpen({ sigma: 0.7 })
              .png({ compressionLevel: 4 })
              .toBuffer();

            psmModesUsed.push('6-benef-roi');
            const benefPage = await ocrWorkerManager.recognizePageWithMode(benefRoiBuf, '6', 8000);
            const candidateText = (benefPage.text || '').replace(/\n+/g, ' ').trim();
            if (candidateText) {
              const reparsed = parseBankakReceiptText(`إسم المرسل إليه ${candidateText}`);
              const cleaned = reparsed.receiverName;
              const currentEval = evaluateArabicNameCompleteness(parsed.receiverName);
              const roiEval = evaluateArabicNameCompleteness(cleaned);
              const shouldAdopt =
                (roiEval.isClean && roiEval.wordCount > currentEval.wordCount) ||
                (!currentEval.isClean && roiEval.isClean) ||
                (!parsed.receiverNameValid && cleaned.length > 3);

              if (cleaned && shouldAdopt) {
                parsed.receiverName = cleaned;
                parsed.receiverNameValid = true;
                parsed.receiverNameQuality = roiEval.quality;
                parsed.receiverNameNeedsReview = roiEval.quality !== 'full';
                if (parsed.confidenceBreakdown) {
                  parsed.confidenceBreakdown.recipientConfidence = 25;
                  parsed.confidenceBreakdown.overall =
                    parsed.confidenceBreakdown.transactionIdConfidence +
                    parsed.confidenceBreakdown.amountConfidence +
                    parsed.confidenceBreakdown.recipientConfidence +
                    parsed.confidenceBreakdown.accountConfidence +
                    parsed.confidenceBreakdown.dateConfidence;
                  parsed.fieldExtractionConfidence = parsed.confidenceBreakdown.overall;
                }
              }
            }
          }
        } catch (benefErr: any) {
          console.warn('[OCR Beneficiary ROI Notice]:', benefErr?.message || benefErr);
        }
      }
    }

    const warnings = [...(parsed.ocrWarnings || [])];
    if (parsed.receiverNameNeedsReview) {
      warnings.push(
        parsed.receiverNameQuality === 'partial'
          ? 'اسم المستفيد مستخرج بشكل جزئي (كلمتان فقط) ويُفضل مراجعته'
          : 'اسم المستفيد غير مؤكد ويحتاج مراجعة'
      );
    }
    if (prep.warning) warnings.push(prep.warning);

    return {
      parsed,
      imageHash,
      rawText: combinedRawText,
      engineUsed: 'tesseract',
      durationMs: Date.now() - startTime,
      diagnostics: {
        tesseractConfidence: Math.round(bestPageForRoi.confidence),
        psmModesUsed,
        preprocessingSteps: prep.stepsApplied,
        roiVerified,
        warnings,
      },
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
