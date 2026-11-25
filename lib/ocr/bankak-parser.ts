import crypto from 'crypto';
import { stripUnicodeBidi, normalizeDigits } from './number-normalizer';
import { parseBankakAmount, ParsedAmountResult, detectCurrency } from './amount-parser';

export { stripUnicodeBidi, normalizeDigits } from './number-normalizer';
export { parseBankakAmount, type ParsedAmountResult } from './amount-parser';

export interface OcrBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWordToken {
  text: string;
  confidence: number;
  bbox: OcrBbox;
}

export interface OcrLineToken {
  text: string;
  confidence: number;
  bbox: OcrBbox;
  words: OcrWordToken[];
}

export interface OcrPageData {
  text: string;
  confidence: number; // 0 - 100 from Tesseract
  lines: OcrLineToken[];
  psm?: string;
}

export interface ConfidenceBreakdown {
  transactionIdConfidence: number; // 0 - 25
  amountConfidence: number;        // 0 - 25
  recipientConfidence: number;     // 0 - 25
  accountConfidence: number;       // 0 - 15
  dateConfidence: number;          // 0 - 10
  overall: number;                 // 0 - 100
}

export interface AmountConfidenceDetail {
  wordConfidence: number;
  separatorInterpretation: string;
  rawToken: string;
  method: 'region_bbox' | 'roi_reocr' | 'text_regex';
}

export interface ParsedBankakReceipt {
  transactionId: string;
  amount: number;
  amountNeedsReview: boolean;
  currency: string;
  senderName: string;
  senderAccount: string;
  receiverName: string;
  receiverAccount: string;
  transactionDate: string; // YYYY-MM-DD
  transactionTime: string; // HH:mm:ss
  bankName: string;
  ocrConfidence: number; // 0 - 100
  rawText: string;
  extractedFieldsCount: number;
  amountValid?: boolean;
  receiverNameValid?: boolean;
  receiverNameQuality?: 'full' | 'partial' | 'uncertain';
  receiverNameNeedsReview?: boolean;
  dateValid?: boolean;
  accountsValid?: boolean;
  confidenceBreakdown?: ConfidenceBreakdown;
  // Enhanced diagnostic fields (non-breaking)
  tesseractConfidence?: number;
  fieldExtractionConfidence?: number;
  amountConfidenceDetail?: AmountConfidenceDetail;
  amountParseResult?: ParsedAmountResult;
  ocrWarnings?: string[];
}

const monthMap: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4,
  'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8,
  'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};

/**
 * Validates Gregorian calendar date strictly (prevents impossible dates like 2026-11-47)
 */
export function isValidDate(year: number, month: number, day: number): boolean {
  if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
  if (year < 2020 || year > 2030) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Calculates SHA-256 hash of an image buffer or base64 string
 */
export function computeImageHash(bufferOrBase64: Buffer | string): string {
  const hash = crypto.createHash('sha256');
  if (typeof bufferOrBase64 === 'string') {
    const cleanBase64 = bufferOrBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    hash.update(cleanBase64);
  } else {
    hash.update(bufferOrBase64);
  }
  return hash.digest('hex');
}

export const AMOUNT_LABEL_REGEX = /(?:المبل[غخع]|القيم[ةه]|مبلغ\s*(?:التحويل|العملية)|Amount)/i;
export const AMOUNT_LABEL_STRIP_REGEX = /^.*?(?:المبل[غخع]|القيم[ةه]|مبلغ\s*(?:التحويل|العملية)|Amount)[\s:|]*/i;
const NON_AMOUNT_LINE_GUARD = /(?:حساب|رقم\s*العملية|رقم\s*الموبايل|التعليق|التاريخ|N\/A|موافق|إضافة\s*مستفيد|تحويل\s*مرة)/i;

/**
 * Groups Tesseract lines into visual horizontal rows using vertical bbox overlap,
 * then locates the Amount label row and extracts the numeric amount + word confidence + bbox.
 */
export function extractAmountRegionFromPage(pageData?: OcrPageData): {
  parsedAmount?: ParsedAmountResult;
  wordConfidence: number;
  bandBbox?: OcrBbox;
} | null {
  if (!pageData || !pageData.lines || pageData.lines.length === 0) return null;

  // Sort lines top-to-bottom
  const sortedLines = [...pageData.lines]
    .filter((l) => l.text && l.text.trim().length > 0)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);

  if (sortedLines.length === 0) return null;

  // Group into visual rows based on vertical center proximity
  const rows: OcrLineToken[][] = [];
  for (const line of sortedLines) {
    const lineCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
    const lineHeight = Math.max(12, line.bbox.y1 - line.bbox.y0);
    const existingRow = rows.find((r) => {
      const ref = r[0];
      const refCenterY = (ref.bbox.y0 + ref.bbox.y1) / 2;
      const refHeight = Math.max(12, ref.bbox.y1 - ref.bbox.y0);
      return Math.abs(lineCenterY - refCenterY) <= Math.max(lineHeight, refHeight) * 0.65;
    });
    if (existingRow) {
      existingRow.push(line);
    } else {
      rows.push([line]);
    }
  }

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const rowText = normalizeDigits(row.map((l) => l.text).join(' '));
    if (!AMOUNT_LABEL_REGEX.test(rowText)) continue;

    // Compute bounding box of the amount row (and optionally next row for ROI cropping)
    const rowBbox: OcrBbox = {
      x0: Math.min(...row.map((l) => l.bbox.x0)),
      y0: Math.min(...row.map((l) => l.bbox.y0)),
      x1: Math.max(...row.map((l) => l.bbox.x1)),
      y1: Math.max(...row.map((l) => l.bbox.y1)),
    };

    // Strip the label and try parsing numeric content on the same visual row (after or before label)
    const afterLabel = rowText.replace(AMOUNT_LABEL_STRIP_REGEX, '');
    const beforeLabel = rowText.split(AMOUNT_LABEL_REGEX)[0]?.trim() || '';

    const numericWords = row
      .flatMap((l) => l.words || [])
      .filter((w) => /[\d٠-٩۰-۹]/.test(w.text));

    const avgWordConf =
      numericWords.length > 0
        ? Math.round(numericWords.reduce((sum, w) => sum + (w.confidence || 0), 0) / numericWords.length)
        : Math.round(row.reduce((sum, l) => sum + (l.confidence || 0), 0) / row.length);

    for (const candidateText of [afterLabel, beforeLabel]) {
      if (candidateText && /\d/.test(candidateText)) {
        const parsed = parseBankakAmount(candidateText);
        if (parsed.success && !parsed.isAmbiguous) {
          return {
            parsedAmount: parsed,
            wordConfidence: avgWordConf,
            bandBbox: rowBbox,
          };
        }
      }
    }

    // Check immediate next visual row if label row had no number
    if (rIdx + 1 < rows.length) {
      const nextRow = rows[rIdx + 1];
      const nextText = normalizeDigits(nextRow.map((l) => l.text).join(' '));
      const nextBbox: OcrBbox = {
        x0: Math.min(rowBbox.x0, ...nextRow.map((l) => l.bbox.x0)),
        y0: rowBbox.y0,
        x1: Math.max(rowBbox.x1, ...nextRow.map((l) => l.bbox.x1)),
        y1: Math.max(...nextRow.map((l) => l.bbox.y1)),
      };
      const nextNumericWords = nextRow
        .flatMap((l) => l.words || [])
        .filter((w) => /[\d٠-٩۰-۹]/.test(w.text));
      const nextAvgConf =
        nextNumericWords.length > 0
          ? Math.round(
              nextNumericWords.reduce((sum, w) => sum + (w.confidence || 0), 0) / nextNumericWords.length
            )
          : Math.round(nextRow.reduce((sum, l) => sum + (l.confidence || 0), 0) / nextRow.length);

      if (/\d/.test(nextText) && !NON_AMOUNT_LINE_GUARD.test(nextText)) {
        const parsedNext = parseBankakAmount(nextText);
        if (parsedNext.success && !parsedNext.isAmbiguous) {
          return {
            parsedAmount: parsedNext,
            wordConfidence: nextAvgConf,
            bandBbox: nextBbox,
          };
        }
      }
    }

    // Check immediate previous visual row (common in PSM 11 where value precedes label)
    if (rIdx - 1 >= 0) {
      const prevRow = rows[rIdx - 1];
      const prevText = normalizeDigits(prevRow.map((l) => l.text).join(' ')).trim();
      if (/\d/.test(prevText) && !NON_AMOUNT_LINE_GUARD.test(prevText)) {
        const parsedPrev = parseBankakAmount(prevText);
        if (parsedPrev.success && !parsedPrev.isAmbiguous) {
          const prevNumericWords = prevRow
            .flatMap((l) => l.words || [])
            .filter((w) => /[\d٠-٩۰-۹]/.test(w.text));
          const prevAvgConf =
            prevNumericWords.length > 0
              ? Math.round(
                  prevNumericWords.reduce((sum, w) => sum + (w.confidence || 0), 0) / prevNumericWords.length
                )
              : Math.round(prevRow.reduce((sum, l) => sum + (l.confidence || 0), 0) / prevRow.length);
          const prevBbox: OcrBbox = {
            x0: Math.min(rowBbox.x0, ...prevRow.map((l) => l.bbox.x0)),
            y0: Math.min(...prevRow.map((l) => l.bbox.y0)),
            x1: Math.max(rowBbox.x1, ...prevRow.map((l) => l.bbox.x1)),
            y1: rowBbox.y1,
          };
          return {
            parsedAmount: parsedPrev,
            wordConfidence: prevAvgConf,
            bandBbox: prevBbox,
          };
        }
      }
    }

    return {
      wordConfidence: avgWordConf,
      bandBbox: rowBbox,
    };
  }

  return null;
}

const AMOUNT_LABEL_GUARD_STOP = /(?:المبل[غخع]|القيم[ةه]|مبلغ\s*(?:التحويل|العملية)|Amount)/i;

/**
 * Evaluates whether an extracted Arabic beneficiary name is full (3+ clean Arabic words),
 * partial (2 clean Arabic words), or uncertain (contains noise/artifacts or <2 words).
 */
export function evaluateArabicNameCompleteness(name: string): {
  isClean: boolean;
  quality: 'full' | 'partial' | 'uncertain';
  wordCount: number;
} {
  if (!name || name.trim().length < 5) {
    return { isClean: false, quality: 'uncertain', wordCount: 0 };
  }
  const trimmed = name.trim();
  if (/[a-zA-Z0-9><|]/.test(trimmed)) {
    return { isClean: false, quality: 'uncertain', wordCount: 0 };
  }
  if (/(?:[إأآا]?سم\s*الم?رس[لك]|المريل|المستفيد|حساب|الموبايل|التعليق)/i.test(trimmed)) {
    return { isClean: false, quality: 'uncertain', wordCount: 0 };
  }
  const arabicWords = trimmed.split(/\s+/).filter((w) => /^[\u0621-\u064A]{2,}$/.test(w));
  if (arabicWords.length >= 3) {
    return { isClean: true, quality: 'full', wordCount: arabicWords.length };
  }
  if (arabicWords.length === 2) {
    return { isClean: true, quality: 'partial', wordCount: 2 };
  }
  return { isClean: false, quality: 'uncertain', wordCount: arabicWords.length };
}

/**
 * Checks whether an extracted beneficiary name is a clean Arabic name
 * (at least 2 Arabic words, no stray Latin/digit artifacts or label remnants).
 */
export function isCleanArabicName(name: string): boolean {
  return evaluateArabicNameCompleteness(name).isClean;
}

/**
 * Locates the vertical bounding box band of the Beneficiary row
 * using the "الى حساب" (To Account) row above it and "رقم الموبايل" / "التعليق" / "المبلغ" row below it.
 */
export function extractBeneficiaryRegionFromPage(pageData?: OcrPageData): OcrBbox | null {
  if (!pageData || !pageData.lines || pageData.lines.length === 0) return null;

  const sortedLines = [...pageData.lines]
    .filter((l) => l.text && l.text.trim().length > 0)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);

  let toAccBottom: number | null = null;
  let nextFieldTop: number | null = null;
  let maxX1 = 0;

  for (const line of sortedLines) {
    maxX1 = Math.max(maxX1, line.bbox.x1);
    const norm = normalizeDigits(line.text);
    if (/[إا]لى\s*(?:حساب|elles|0ك)|To\s*Account/i.test(norm)) {
      toAccBottom = line.bbox.y1;
      continue;
    }
    if (
      toAccBottom !== null &&
      line.bbox.y0 > toAccBottom &&
      (/(?:رقم\s*الموبايل|التعليق|N\/A|Ubbgall)/i.test(norm) || AMOUNT_LABEL_GUARD_STOP.test(norm))
    ) {
      nextFieldTop = line.bbox.y0;
      break;
    }
  }

  if (toAccBottom !== null && nextFieldTop !== null && nextFieldTop > toAccBottom + 12) {
    return {
      x0: 0,
      y0: toAccBottom,
      x1: maxX1,
      y1: nextFieldTop,
    };
  }

  // Fallback: locate line matching beneficiary label directly
  for (const line of sortedLines) {
    const norm = normalizeDigits(line.text);
    if (/(?:[إأآا]?سم\s*الم?رس[لك]|المريل|المستفيد)/i.test(norm)) {
      return {
        x0: 0,
        y0: Math.max(0, line.bbox.y0 - 8),
        x1: maxX1,
        y1: line.bbox.y1 + 14,
      };
    }
  }

  return null;
}

/**
 * Intelligent rule-based, region-aware Bankak Receipt Parser.
 * Extracts all required fields according to Bankak (Bank of Khartoum) format,
 * using Decimal-backed amount parsing and optional Tesseract bbox/confidence metadata.
 */
export function parseBankakReceiptText(
  rawInput: string,
  pageData?: OcrPageData
): ParsedBankakReceipt {
  const normalized = normalizeDigits(rawInput || '');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  const ocrWarnings: string[] = [];
  let fieldsMatched = 0;

  // Helper: clean beneficiary / name and reject boilerplate, accounts, or single words
  const cleanName = (raw: string): string => {
    if (!raw) return '';
    let c = stripUnicodeBidi(raw).trim();
    // Strip leading digits/symbols & common label OCR variants (إسم المرسل إليه، اسم المريل، سم المرسك، ...)
    c = c.replace(/^[\d\s><|\[\]\(\)\{\}\.\-_*]+/, '');
    c = c.replace(
      /^(?:[إأآا]?سم\s*(?:الم?رس[لك]\s*(?:[إأآا]?لي[هة])?|المريل|المستفيد|المستلم)|الم?رس[لك]\s*[إأآا]?لي[هة]|المستفيد|المستلم|[إا]لى|Jara\s*eal|eal|[eE]{2,4}|[oO]{2,4}|ofc|ere)[\s:><|]*/i,
      ''
    );
    // Strip trailing/leading stray Latin OCR artifacts when Arabic characters are present
    if (/[\u0600-\u06FF]/.test(c)) {
      c = c.replace(/^[a-zA-Z\s><|]{1,10}\s+/i, '');
      c = c.replace(/\s+(?:eal\s*اشم|اشم|eal|aJl|pol|Gab)$/i, '');
    }
    c = c.replace(/^[ا-ي]\s+امل\s+/i, '');
    c = c.split(/\s{2,}|[-|\n\r]/)[0].trim();
    // If predominantly Arabic (2+ Arabic words), remove stray Latin/numeric noise tokens
    const arabicTokens = c.split(/\s+/).filter((t) => /[\u0600-\u06FF]{2,}/.test(t));
    if (arabicTokens.length >= 2) {
      c = c
        .split(/\s+/)
        .filter((t) => !/^(?:[a-zA-Z0-9!><|_]{1,10})$/.test(t))
        .join(' ')
        .trim();
    }
    if (
      !c ||
      /^(?:حساب|الحساب|من\s*حساب|[إأآا]لى\s*حساب|account|n\/a|تحويلات|بنك|مشاركة|طباعة|تحميل|إضافة|التعليق|رقم|المبلغ)/i.test(c) ||
      /^[0-9\s\*\-]+$/.test(c) ||
      c.length <= 3
    ) {
      return '';
    }
    return c;
  };

  // 1. Transaction ID (Strict 8-16 chars, NOT a date or time)
  let transactionId = '';
  const txnLabeled = normalized.match(
    /(?:Transaction\s*(?:ID|No|Ref|Reference)|رقم\s*(?:العملية|المرجع|الإشعار|المعاملة)|الرقم\s*المرجعي|معرف\s*العملية)[\s:]*([A-Za-z0-9\-_]+)/i
  );
  if (txnLabeled && txnLabeled[1]) {
    const val = txnLabeled[1].replace(/[^0-9A-Za-z]/g, '');
    if (val.length >= 8 && !/^[0-9]{1,2}-[A-Za-z]{3}/.test(val)) {
      transactionId = val;
    }
  }
  if (!transactionId) {
    const matchBankak = normalized.match(/\b(2[01][0-9]{9,10})\b/);
    if (matchBankak) {
      transactionId = matchBankak[1];
    }
  }
  if (!transactionId) {
    const matchAny = normalized.match(/\b([0-9]{10,12})\b/);
    if (matchAny) {
      transactionId = matchAny[1];
    }
  }
  if (transactionId) fieldsMatched++;

  // 2. Beneficiary / Receiver Name
  let receiverName = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /(?:[إأآا]?سم\s*(?:الم?رس[لك](?:\s*[إأآا]?لي[هة])?|المريل|المستفيد)|المستفيد\b|الم?رس[لك]\s*[إأآا]?لي[هة])/i.test(
        line
      )
    ) {
      const cleaned = cleanName(line);
      if (cleaned && cleaned.split(/\s+/).length >= 2) {
        receiverName = cleaned;
        break;
      }
      if (i + 1 < lines.length) {
        const nextCleaned = cleanName(lines[i + 1]);
        if (nextCleaned && nextCleaned.split(/\s+/).length >= 2) {
          receiverName = nextCleaned;
          break;
        }
      }
    }
  }

  if (!receiverName) {
    let toAccountIdx = -1;
    let amountIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/[إا]لى\s*(?:حساب|elles|0ك)|To\s*Account/i.test(lines[i])) toAccountIdx = i;
      if (/المبلغ|Amount|رقم\s*الموبايل/i.test(lines[i])) {
        if (amountIdx === -1) amountIdx = i;
      }
    }

    if (toAccountIdx !== -1) {
      const endLimit = amountIdx !== -1 ? amountIdx : Math.min(toAccountIdx + 4, lines.length);
      for (let i = toAccountIdx + 1; i <= endLimit; i++) {
        if (i < lines.length) {
          const candidate = cleanName(lines[i]);
          if (candidate && candidate.split(/\s+/).length >= 2 && /[\u0600-\u06FF]/.test(candidate)) {
            receiverName = candidate;
            break;
          }
        }
      }
    }
  }

  if (!receiverName) {
    for (const line of lines) {
      if (/^[ا-ي]\s+امل\s+([ا-ي\s]{6,40})/i.test(line)) {
        const m = line.match(/^[ا-ي]\s+امل\s+([ا-ي\s]{6,40})/i);
        if (m) {
          receiverName = cleanName(m[1]);
          if (receiverName) break;
        }
      }
    }
  }

  if (receiverName) fieldsMatched++;

  // 3. Amount (Region/BBox-aware first, then labeled regex + Decimal parser, then currency fallback)
  let amount = 0;
  let amountValid = false;
  let amountParseResult: ParsedAmountResult | undefined;
  let amountConfidenceDetail: AmountConfidenceDetail | undefined;
  let currency = detectCurrency(normalized, 'SDG');

  // 3A: Try Region / BBox extraction if pageData is available
  const regionResult = extractAmountRegionFromPage(pageData);
  if (regionResult?.parsedAmount && regionResult.parsedAmount.success) {
    amountParseResult = regionResult.parsedAmount;
    amount = regionResult.parsedAmount.value;
    currency = regionResult.parsedAmount.currency;
    amountValid = amount > 0;
    amountConfidenceDetail = {
      wordConfidence: regionResult.wordConfidence,
      separatorInterpretation: regionResult.parsedAmount.separatorInterpretation,
      rawToken: regionResult.parsedAmount.originalText,
      method: 'region_bbox',
    };
  }

  // 3B: Labeled line (same line before/after label, next line, or previous line) using parseBankakAmount
  if (!amountValid) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (AMOUNT_LABEL_REGEX.test(line)) {
        const afterLabel = line.replace(AMOUNT_LABEL_STRIP_REGEX, '');
        const beforeLabel = line.split(AMOUNT_LABEL_REGEX)[0]?.trim() || '';
        const sameCandidates = [afterLabel, beforeLabel];

        for (const cand of sameCandidates) {
          if (cand && /\d/.test(cand)) {
            const parsedSame = parseBankakAmount(cand, currency);
            if (parsedSame.success && !parsedSame.isAmbiguous) {
              amountParseResult = parsedSame;
              amount = parsedSame.value;
              currency = parsedSame.currency;
              amountValid = true;
              amountConfidenceDetail = {
                wordConfidence: regionResult?.wordConfidence ?? (pageData ? Math.round(pageData.confidence) : 100),
                separatorInterpretation: parsedSame.separatorInterpretation,
                rawToken: parsedSame.originalText,
                method: 'text_regex',
              };
              break;
            } else if (parsedSame.isAmbiguous) {
              amountParseResult = parsedSame;
              ocrWarnings.push(parsedSame.ambiguityReason || 'صيغة المبلغ غامضة');
            }
          }
        }
        if (amountValid) break;

        // Next line
        if (i + 1 < lines.length && /\d/.test(lines[i + 1]) && !NON_AMOUNT_LINE_GUARD.test(lines[i + 1])) {
          const parsedNext = parseBankakAmount(lines[i + 1], currency);
          if (parsedNext.success && !parsedNext.isAmbiguous) {
            amountParseResult = parsedNext;
            amount = parsedNext.value;
            currency = parsedNext.currency;
            amountValid = true;
            amountConfidenceDetail = {
              wordConfidence: regionResult?.wordConfidence ?? (pageData ? Math.round(pageData.confidence) : 100),
              separatorInterpretation: parsedNext.separatorInterpretation,
              rawToken: parsedNext.originalText,
              method: 'text_regex',
            };
            break;
          } else if (parsedNext.isAmbiguous) {
            amountParseResult = parsedNext;
            ocrWarnings.push(parsedNext.ambiguityReason || 'صيغة المبلغ غامضة');
          }
        }

        // Previous line (common in RTL / PSM 11 when amount precedes label)
        if (i - 1 >= 0 && /\d/.test(lines[i - 1]) && !NON_AMOUNT_LINE_GUARD.test(lines[i - 1])) {
          const parsedPrev = parseBankakAmount(lines[i - 1], currency);
          if (parsedPrev.success && !parsedPrev.isAmbiguous) {
            amountParseResult = parsedPrev;
            amount = parsedPrev.value;
            currency = parsedPrev.currency;
            amountValid = true;
            amountConfidenceDetail = {
              wordConfidence: regionResult?.wordConfidence ?? (pageData ? Math.round(pageData.confidence) : 100),
              separatorInterpretation: parsedPrev.separatorInterpretation,
              rawToken: parsedPrev.originalText,
              method: 'text_regex',
            };
            break;
          } else if (parsedPrev.isAmbiguous) {
            amountParseResult = parsedPrev;
            ocrWarnings.push(parsedPrev.ambiguityReason || 'صيغة المبلغ غامضة');
          }
        }
      }
    }
  }

  // 3C: Currency fallback (supports grouped or plain digits with SDG / ج.س / جنيه)
  if (!amountValid) {
    const currencyMatch =
      normalized.match(
        /((?:\d{1,3}(?:[.,'\s]\d{3})+|\d+)(?:[.,]\d{1,4})?)\s*(?:SDG|ج\.س|جنيه)/i
      ) ||
      normalized.match(
        /(?:SDG|ج\.س|جنيه)[\s:]*((?:\d{1,3}(?:[.,'\s]\d{3})+|\d+)(?:[.,]\d{1,4})?)/i
      );
    if (currencyMatch && currencyMatch[1]) {
      const parsedCur = parseBankakAmount(currencyMatch[1], currency);
      if (parsedCur.success && !parsedCur.isAmbiguous) {
        amountParseResult = parsedCur;
        amount = parsedCur.value;
        amountValid = true;
        amountConfidenceDetail = {
          wordConfidence: pageData ? Math.round(pageData.confidence) : 100,
          separatorInterpretation: parsedCur.separatorInterpretation,
          rawToken: parsedCur.originalText,
          method: 'text_regex',
        };
      }
    }
  }

  if (amountValid) fieldsMatched++;

  // 4. Accounts (From Account / To Account) - preserving leading zeros
  let senderAccount = '';
  let receiverAccount = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/من\s*حساب|From\s*Account/i.test(line)) {
      const match = line.match(/(?:من\s*حساب|From\s*Account)[\s:]*([0-9\s]{6,30})/i);
      if (match) {
        senderAccount = match[1].replace(/\s+/g, '');
      } else if (i + 1 < lines.length && /^[0-9\s]{6,30}$/.test(lines[i + 1])) {
        senderAccount = lines[i + 1].replace(/\s+/g, '');
      }
    }
    if (/[إا]لى\s*(?:حساب|elles|0ك)|To\s*Account/i.test(line)) {
      const match = line.match(/(?:[إا]لى\s*(?:حساب|elles|0ك)|To\s*Account)[\s:]*([0-9\s]{6,30})/i);
      if (match) {
        receiverAccount = match[1].replace(/\s+/g, '');
      } else if (i + 1 < lines.length && /^[0-9\s]{6,30}$/.test(lines[i + 1])) {
        receiverAccount = lines[i + 1].replace(/\s+/g, '');
      }
    }
  }

  if (senderAccount) fieldsMatched++;
  if (receiverAccount) fieldsMatched++;

  // 5. Sender Name (Optional - empty in Bankak transfers)
  const senderName = '';

  // 6. Date & Time Validation
  let dateMatched = false;
  let transactionDate = '';
  let transactionTime = '';

  const timeMatch = normalized.match(/([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:\s*[AaPp][Mm])?)/);
  if (timeMatch) {
    transactionTime = timeMatch[1].trim();
    fieldsMatched++;
  }

  const namedMatch = normalized.match(/\b([0-9]{1,2})[\s\-\/\.]([A-Za-z\u0621-\u064A]{3,9})[\s\-\/\.]([0-9]{4})\b/i);
  if (namedMatch) {
    const d = parseInt(namedMatch[1], 10);
    const mStr = namedMatch[2].toLowerCase();
    const y = parseInt(namedMatch[3], 10);
    const m = monthMap[mStr];
    if (m && isValidDate(y, m, d)) {
      transactionDate = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      dateMatched = true;
      fieldsMatched++;
    }
  }

  if (!dateMatched) {
    const numMatch = normalized.match(/\b([0-9]{1,4})[\/\-\.]([0-9]{1,2})[\/\-\.]([0-9]{1,4})\b/);
    if (numMatch) {
      let y = 0, m = 0, d = 0;
      if (numMatch[1].length === 4) {
        y = parseInt(numMatch[1], 10);
        m = parseInt(numMatch[2], 10);
        d = parseInt(numMatch[3], 10);
      } else if (numMatch[3].length === 4) {
        d = parseInt(numMatch[1], 10);
        m = parseInt(numMatch[2], 10);
        y = parseInt(numMatch[3], 10);
      }
      if (isValidDate(y, m, d)) {
        transactionDate = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
        dateMatched = true;
        fieldsMatched++;
      }
    }
  }

  // 7. Honest Confidence Scoring + OCR Error Detection
  const receiverNameValid = Boolean(receiverName && receiverName.length > 3);
  const nameEval = evaluateArabicNameCompleteness(receiverName);
  const receiverNameQuality = receiverNameValid ? nameEval.quality : 'uncertain';
  const receiverNameNeedsReview = !receiverNameValid || receiverNameQuality !== 'full';
  const accountsValid = senderAccount.length >= 6 || receiverAccount.length >= 6;

  const confidenceBreakdown: ConfidenceBreakdown = {
    transactionIdConfidence: transactionId ? 25 : 0,
    amountConfidence: amountValid ? 25 : 0,
    recipientConfidence: receiverNameValid ? 25 : 0,
    accountConfidence: accountsValid ? 15 : 0,
    dateConfidence: dateMatched ? 10 : 0,
    overall: 0,
  };
  confidenceBreakdown.overall =
    confidenceBreakdown.transactionIdConfidence +
    confidenceBreakdown.amountConfidence +
    confidenceBreakdown.recipientConfidence +
    confidenceBreakdown.accountConfidence +
    confidenceBreakdown.dateConfidence;

  const fieldExtractionConfidence = confidenceBreakdown.overall;
  const tesseractConfidence = pageData ? Math.round(pageData.confidence) : undefined;

  if (tesseractConfidence !== undefined && tesseractConfidence < 60) {
    ocrWarnings.push(`انخفاض ثقة محرك Tesseract العامة (${tesseractConfidence}%)`);
  }
  if (amountConfidenceDetail && amountConfidenceDetail.wordConfidence < 65) {
    ocrWarnings.push(`انخفاض ثقة قراءة حروف المبلغ (${amountConfidenceDetail.wordConfidence}%)`);
  }
  if (!amountValid) {
    ocrWarnings.push('تعذر استخراج مبلغ مالي واضح وموثوق');
  }

  // Compute honest overall ocrConfidence:
  // For image OCR (when pageData is provided), blend structural field extraction (65%) + real Tesseract confidence (35%),
  // and cap if amount word confidence is critically low.
  let overallConfidence = fieldExtractionConfidence;
  if (tesseractConfidence !== undefined) {
    overallConfidence = Math.round(fieldExtractionConfidence * 0.65 + tesseractConfidence * 0.35);
    if (amountConfidenceDetail && amountConfidenceDetail.wordConfidence < 50 && overallConfidence > 65) {
      overallConfidence = 65;
    }
    if (!amountValid && overallConfidence > 65) {
      overallConfidence = 65;
    }
  }

  return {
    transactionId: transactionId || '',
    amount,
    amountNeedsReview: !amountValid || amount <= 0,
    currency: currency || 'SDG',
    senderName: senderName || '',
    senderAccount: senderAccount || '',
    receiverName: receiverName || '',
    receiverAccount: receiverAccount || '',
    transactionDate,
    transactionTime: transactionTime || '12:00:00',
    bankName: 'بنكك - بنك الخرطوم (Bank of Khartoum)',
    ocrConfidence: overallConfidence,
    rawText: rawInput,
    extractedFieldsCount: fieldsMatched,
    amountValid,
    receiverNameValid,
    receiverNameQuality,
    receiverNameNeedsReview,
    dateValid: dateMatched,
    accountsValid,
    confidenceBreakdown,
    tesseractConfidence,
    fieldExtractionConfidence,
    amountConfidenceDetail,
    amountParseResult,
    ocrWarnings: ocrWarnings.length > 0 ? ocrWarnings : undefined,
  };
}

/**
 * Merges best extracted fields from multi-mode OCR passes (e.g. PSM 4, PSM 11, PSM 6)
 */
export function mergeParsedResults(p1: ParsedBankakReceipt, p2: ParsedBankakReceipt): ParsedBankakReceipt {
  const isP1TxnValid = Boolean(
    p1.transactionId && p1.transactionId.length >= 8 && !/^[0-9]{1,2}-[A-Za-z]{3}/.test(p1.transactionId)
  );
  const isP2TxnValid = Boolean(
    p2.transactionId && p2.transactionId.length >= 8 && !/^[0-9]{1,2}-[A-Za-z]{3}/.test(p2.transactionId)
  );
  const transactionId = isP1TxnValid ? p1.transactionId : isP2TxnValid ? p2.transactionId : '';

  // Prefer valid amount; if both valid, prefer higher wordConfidence or region_bbox
  let chosenAmountResult = p1;
  if (!p1.amountValid && p2.amountValid) {
    chosenAmountResult = p2;
  } else if (p1.amountValid && p2.amountValid) {
    const c1 = p1.amountConfidenceDetail?.wordConfidence ?? 0;
    const c2 = p2.amountConfidenceDetail?.wordConfidence ?? 0;
    if (c2 > c1 + 10) {
      chosenAmountResult = p2;
    }
  }

  const amountValid = Boolean(chosenAmountResult.amountValid);
  const amount = amountValid ? chosenAmountResult.amount : 0;

  const qRank = (q?: 'full' | 'partial' | 'uncertain') => (q === 'full' ? 3 : q === 'partial' ? 2 : 1);
  let receiverName = '';
  if (p1.receiverNameValid && p2.receiverNameValid) {
    const r1 = qRank(p1.receiverNameQuality);
    const r2 = qRank(p2.receiverNameQuality);
    if (r2 > r1) {
      receiverName = p2.receiverName;
    } else if (r1 > r2) {
      receiverName = p1.receiverName;
    } else {
      const w1 = evaluateArabicNameCompleteness(p1.receiverName).wordCount;
      const w2 = evaluateArabicNameCompleteness(p2.receiverName).wordCount;
      receiverName = w2 > w1 ? p2.receiverName : p1.receiverName;
    }
  } else {
    receiverName = p1.receiverNameValid ? p1.receiverName : p2.receiverNameValid ? p2.receiverName : '';
  }
  const receiverNameValid = Boolean(receiverName && receiverName.length > 3);
  const mergedNameEval = evaluateArabicNameCompleteness(receiverName);
  const receiverNameQuality = receiverNameValid ? mergedNameEval.quality : 'uncertain';
  const receiverNameNeedsReview = !receiverNameValid || receiverNameQuality !== 'full';

  const senderName = p1.senderName || p2.senderName || '';
  const senderAccount =
    p1.senderAccount && p1.senderAccount.length >= 6 ? p1.senderAccount : p2.senderAccount || '';
  const receiverAccount =
    p1.receiverAccount && p1.receiverAccount.length >= 6 ? p1.receiverAccount : p2.receiverAccount || '';
  const accountsValid = Boolean(senderAccount.length >= 6 || receiverAccount.length >= 6);

  const dateValid = p1.dateValid || p2.dateValid;
  const transactionDate = p1.dateValid ? p1.transactionDate : p2.dateValid ? p2.transactionDate : '';
  const transactionTime =
    p1.transactionTime && p1.transactionTime !== '12:00:00'
      ? p1.transactionTime
      : p2.transactionTime || '12:00:00';

  const confidenceBreakdown: ConfidenceBreakdown = {
    transactionIdConfidence: transactionId ? 25 : 0,
    amountConfidence: amountValid ? 25 : 0,
    recipientConfidence: receiverNameValid ? 25 : 0,
    accountConfidence: accountsValid ? 15 : 0,
    dateConfidence: dateValid ? 10 : 0,
    overall: 0,
  };
  confidenceBreakdown.overall =
    confidenceBreakdown.transactionIdConfidence +
    confidenceBreakdown.amountConfidence +
    confidenceBreakdown.recipientConfidence +
    confidenceBreakdown.accountConfidence +
    confidenceBreakdown.dateConfidence;

  const bestTesseractConf = Math.max(p1.tesseractConfidence ?? 0, p2.tesseractConfidence ?? 0);
  const hasTessConf = p1.tesseractConfidence !== undefined || p2.tesseractConfidence !== undefined;

  let overallConfidence = confidenceBreakdown.overall;
  if (hasTessConf) {
    overallConfidence = Math.round(confidenceBreakdown.overall * 0.65 + bestTesseractConf * 0.35);
    if (!amountValid && overallConfidence > 65) overallConfidence = 65;
  }

  const mergedWarnings = Array.from(new Set([...(p1.ocrWarnings || []), ...(p2.ocrWarnings || [])]));

  return {
    transactionId: transactionId || '',
    amount,
    amountNeedsReview: !amountValid || amount <= 0,
    currency: chosenAmountResult.currency || 'SDG',
    senderName,
    senderAccount,
    receiverName,
    receiverAccount,
    transactionDate,
    transactionTime,
    bankName: 'بنكك - بنك الخرطوم (Bank of Khartoum)',
    ocrConfidence: overallConfidence,
    rawText: `${p1.rawText}\n--- Secondary OCR ---\n${p2.rawText}`,
    extractedFieldsCount: Math.max(p1.extractedFieldsCount, p2.extractedFieldsCount),
    amountValid,
    receiverNameValid,
    receiverNameQuality,
    receiverNameNeedsReview,
    dateValid,
    accountsValid,
    confidenceBreakdown,
    tesseractConfidence: hasTessConf ? bestTesseractConf : undefined,
    fieldExtractionConfidence: confidenceBreakdown.overall,
    amountConfidenceDetail: chosenAmountResult.amountConfidenceDetail,
    amountParseResult: chosenAmountResult.amountParseResult,
    ocrWarnings: mergedWarnings.length > 0 ? mergedWarnings : undefined,
  };
}

export interface ReceiptRiskAssessment {
  isDuplicate: boolean;
  isSuspicious: boolean;
  status: 'pending_verification' | 'duplicate' | 'suspicious';
  reason?: string;
  matchedReceiptId?: string;
}

/**
 * Multi-attribute anti-fraud and duplication engine:
 * Tier 1 (Confirmed Duplicate): Exact Transaction ID or Exact Image Hash (SHA-256)
 * Tier 2 (Suspicious Receipt): Same Amount + Same Date + Matching Sender Name
 */
export function evaluateReceiptRisk(
  newReceipt: {
    transactionId: string;
    imageHash: string;
    amount: number;
    transactionDate?: string;
    senderName?: string;
  },
  existingReceipts: Array<{
    id: string;
    transactionId: string;
    imageHash: string;
    amount: any;
    transactionDate?: string | null;
    senderName?: string | null;
    status: string;
  }>
): ReceiptRiskAssessment {
  for (const existing of existingReceipts) {
    if (
      existing.transactionId &&
      newReceipt.transactionId &&
      existing.transactionId.trim().toLowerCase() === newReceipt.transactionId.trim().toLowerCase()
    ) {
      return {
        isDuplicate: true,
        isSuspicious: false,
        status: 'duplicate',
        reason: `تطابق قطعي: رقم العملية (${newReceipt.transactionId}) مسجل مسبقاً في النظام بالإيصال رقم ${existing.id.substring(0, 8)}`,
        matchedReceiptId: existing.id,
      };
    }
    if (
      existing.imageHash &&
      newReceipt.imageHash &&
      existing.imageHash === newReceipt.imageHash &&
      !existing.imageHash.startsWith('synthetic')
    ) {
      return {
        isDuplicate: true,
        isSuspicious: false,
        status: 'duplicate',
        reason: `تطابق قطعي: بصمة الصورة الرقمية (SHA-256) مطابقة تماماً لإيصال مسجل مسبقاً`,
        matchedReceiptId: existing.id,
      };
    }
  }

  for (const existing of existingReceipts) {
    if (existing.status === 'rejected' || existing.status === 'duplicate') continue;
    const hasValidAmount = Number(newReceipt.amount) > 0 && Number(existing.amount) > 0;
    const sameAmount = hasValidAmount && Math.abs(Number(existing.amount) - Number(newReceipt.amount)) < 0.01;
    const sameDate =
      existing.transactionDate &&
      newReceipt.transactionDate &&
      existing.transactionDate === newReceipt.transactionDate;

    const senderA = (existing.senderName || '').trim();
    const senderB = (newReceipt.senderName || '').trim();
    const isDefaultSender =
      senderA === 'غير محدد' ||
      senderB === 'غير محدد' ||
      senderA === 'Unknown' ||
      senderB === 'Unknown' ||
      senderA === 'غير معروف' ||
      senderB === 'غير معروف';
    const senderSimilar =
      !isDefaultSender &&
      senderA.length > 3 &&
      senderB.length > 3 &&
      (senderA.includes(senderB) || senderB.includes(senderA));

    if (sameAmount && sameDate && senderSimilar) {
      return {
        isDuplicate: false,
        isSuspicious: true,
        status: 'suspicious',
        reason: `اشتباه تكرار: المبلغ (${newReceipt.amount.toLocaleString()} SDG) والتاريخ (${newReceipt.transactionDate}) واسم المرسل يتطابق مع إيصال مسجل برقم ${existing.transactionId}`,
        matchedReceiptId: existing.id,
      };
    }
  }

  return {
    isDuplicate: false,
    isSuspicious: false,
    status: 'pending_verification',
  };
}
