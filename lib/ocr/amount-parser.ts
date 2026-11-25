import Decimal from 'decimal.js';
import { normalizeDigits } from './number-normalizer';

export type SeparatorInterpretation =
  | 'standard_comma_thousands_dot_decimal'
  | 'european_dot_thousands_comma_decimal'
  | 'multi_dot_thousands'
  | 'space_thousands'
  | 'apostrophe_thousands'
  | 'mixed_dot_comma_thousands_heuristic'
  | 'plain_integer_or_decimal'
  | 'ambiguous'
  | 'not_found';

export interface ParsedAmountResult {
  originalText: string;
  normalizedText: string;
  value: number;
  decimalValue: string;
  currency: string;
  separatorInterpretation: SeparatorInterpretation;
  success: boolean;
  isAmbiguous: boolean;
  ambiguityReason?: string;
}

/**
 * Extracts currency code from text if present, otherwise returns defaultCurrency.
 */
export function detectCurrency(text: string, defaultCurrency = 'SDG'): string {
  if (!text) return defaultCurrency;
  if (/(?:SDG|ج\.س|جنيه\s*سوداني|جنيه)/i.test(text)) return 'SDG';
  if (/(?:EGP|ج\.م|جنيه\s*مصري)/i.test(text)) return 'EGP';
  if (/(?:USD|\$)/i.test(text)) return 'USD';
  if (/(?:SAR|ر\.س)/i.test(text)) return 'SAR';
  if (/(?:AED|د\.إ)/i.test(text)) return 'AED';
  return defaultCurrency;
}

/**
 * Extracts a clean numeric token from a raw amount string, preserving
 * digits, dots, commas, apostrophes, and internal spaces between digit groups.
 */
function extractNumericToken(normalized: string): string {
  // Match grouped numbers with space/apostrophe/dot/comma separators or plain numbers
  const match = normalized.match(
    /(?:\d{1,3}(?:[.,'\s]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)/
  );
  return match ? match[0].trim() : '';
}

/**
 * Independent, Decimal-backed financial amount parser for Bankak receipts.
 * Never uses raw parseFloat on unnormalized strings.
 * Distinguishes thousands separators (comma, dot, space, apostrophe, Arabic separators)
 * from decimal separators based on digit grouping and context.
 */
export function parseBankakAmount(
  input: string,
  defaultCurrency = 'SDG'
): ParsedAmountResult {
  const originalText = input ?? '';
  const normalizedText = normalizeDigits(originalText).trim();
  const currency = detectCurrency(normalizedText, defaultCurrency);

  if (!normalizedText) {
    return {
      originalText,
      normalizedText,
      value: 0,
      decimalValue: '0',
      currency,
      separatorInterpretation: 'not_found',
      success: false,
      isAmbiguous: false,
      ambiguityReason: 'النص فارغ',
    };
  }

  const token = extractNumericToken(normalizedText);
  if (!token) {
    return {
      originalText,
      normalizedText,
      value: 0,
      decimalValue: '0',
      currency,
      separatorInterpretation: 'not_found',
      success: false,
      isAmbiguous: false,
      ambiguityReason: 'لم يتم العثور على قيمة رقمية صالحة',
    };
  }

  let canonical = '';
  let interpretation: SeparatorInterpretation = 'plain_integer_or_decimal';

  // Case 1: Space-separated thousands (e.g. "2 500 000" or "2 500 000.00")
  if (/^\d{1,3}(?:\s\d{3})+(?:[.,]\d{1,4})?$/.test(token)) {
    interpretation = 'space_thousands';
    const parts = token.split(/([.,]\d{1,4})$/);
    const intPart = parts[0].replace(/\s+/g, '');
    const decPart = parts[1] ? '.' + parts[1].slice(1) : '';
    canonical = intPart + decPart;
  }
  // Case 2: Apostrophe-separated thousands (e.g. "2'500'000" or "2'500'000.00")
  else if (/^\d{1,3}(?:'\d{3})+(?:[.,]\d{1,4})?$/.test(token)) {
    interpretation = 'apostrophe_thousands';
    const parts = token.split(/([.,]\d{1,4})$/);
    const intPart = parts[0].replace(/'/g, '');
    const decPart = parts[1] ? '.' + parts[1].slice(1) : '';
    canonical = intPart + decPart;
  }
  // Case 3: Multiple dots as thousands separators (e.g. "2.500.000" or "2.500.000,00")
  else if (/^\d{1,3}(?:\.\d{3}){2,}(?:,\d{1,4})?$/.test(token)) {
    interpretation = 'multi_dot_thousands';
    const [intPart, decPart] = token.split(',');
    canonical = intPart.replace(/\./g, '') + (decPart ? '.' + decPart : '');
  }
  // Case 4: OCR mixed dot/comma thousands (e.g. "1.943,000.00" or "1.943,000" observed in Tesseract)
  else if (/^\d{1,3}(?:[.,]\d{3}){2,}(?:\.\d{1,2})?$/.test(token) && token.includes('.') && token.includes(',')) {
    // Check if last dot has <= 2 digits (decimal) and earlier dots/commas are 3-digit groups
    const lastDotIdx = token.lastIndexOf('.');
    const afterLastDot = token.slice(lastDotIdx + 1);
    if (/^\d{1,2}$/.test(afterLastDot) && !afterLastDot.includes(',')) {
      interpretation = 'mixed_dot_comma_thousands_heuristic';
      const intPart = token.slice(0, lastDotIdx).replace(/[.,]/g, '');
      canonical = `${intPart}.${afterLastDot}`;
    } else if (/^\d{1,3}(?:[.,]\d{3}){2,}$/.test(token)) {
      // e.g. "1.943,000" where all groups are 3 digits
      interpretation = 'mixed_dot_comma_thousands_heuristic';
      canonical = token.replace(/[.,]/g, '');
    }
  }
  // Case 5: European dot-thousands + comma-decimal (e.g. "2.500,00" or "2.500.000,50")
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,4}$/.test(token)) {
    interpretation = 'european_dot_thousands_comma_decimal';
    const [intPart, decPart] = token.split(',');
    canonical = `${intPart.replace(/\./g, '')}.${decPart}`;
  }
  // Case 6: Standard comma-thousands with optional dot-decimal (e.g. "2,500,000" or "2,500,000.00")
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?$/.test(token)) {
    interpretation = 'standard_comma_thousands_dot_decimal';
    canonical = token.replace(/,/g, '');
  }
  // Case 7: Plain integer or simple decimal (e.g. "2500000", "220", "220.50", "220,50")
  else if (/^\d+(?:[.,]\d{1,4})?$/.test(token)) {
    // Watch out for ambiguous single dot/comma with exactly 3 trailing digits like "2.500" or "2,500"
    const singleDot3 = token.match(/^(\d{1,3})\.(\d{3})$/);
    if (singleDot3) {
      // In Sudanese SDG (Bankak), amounts are typically whole thousands/millions; "2.500" with 3 decimals is ambiguous or European thousands.
      // Mark as ambiguous if <= 3 digits before single dot and 3 digits after, unless followed by .00
      return {
        originalText,
        normalizedText,
        value: 0,
        decimalValue: '0',
        currency,
        separatorInterpretation: 'ambiguous',
        success: false,
        isAmbiguous: true,
        ambiguityReason: `صيغة غامضة (${token}): نقطة واحدة متبوعة بثلاث خانات قد تعني آلافاً أو كسراً عشرياً`,
      };
    }
    interpretation = 'plain_integer_or_decimal';
    canonical = token.replace(',', '.');
  }
  // Anything else with multiple separators that doesn't fit valid grouping -> ambiguous!
  else {
    return {
      originalText,
      normalizedText,
      value: 0,
      decimalValue: '0',
      currency,
      separatorInterpretation: 'ambiguous',
      success: false,
      isAmbiguous: true,
      ambiguityReason: `تعذر تفسير الفواصل بأمان في القيمة: ${token}`,
    };
  }

  try {
    const dec = new Decimal(canonical);
    if (!dec.isFinite() || dec.isNegative()) {
      return {
        originalText,
        normalizedText,
        value: 0,
        decimalValue: '0',
        currency,
        separatorInterpretation: 'ambiguous',
        success: false,
        isAmbiguous: true,
        ambiguityReason: `قيمة غير صالحة بعد التحويل: ${canonical}`,
      };
    }

    const numVal = dec.toNumber();
    return {
      originalText,
      normalizedText,
      value: numVal,
      decimalValue: dec.toFixed(),
      currency,
      separatorInterpretation: interpretation,
      success: numVal > 0,
      isAmbiguous: false,
    };
  } catch {
    return {
      originalText,
      normalizedText,
      value: 0,
      decimalValue: '0',
      currency,
      separatorInterpretation: 'ambiguous',
      success: false,
      isAmbiguous: true,
      ambiguityReason: `فشل التحويل الدقيق عبر Decimal للقيمة: ${canonical}`,
    };
  }
}
