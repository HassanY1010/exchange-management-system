/**
 * Independent Number & Text Normalization Layer for Bankak OCR
 * Handles Latin, Eastern Arabic (٠-٩), Persian/Urdu (۰-۹) digits,
 * Arabic/Latin thousands & decimal separators, non-breaking spaces,
 * and invisible Unicode Bidi/formatting characters without destroying
 * financial separator semantics.
 */

const EASTERN_ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/**
 * Strips invisible Unicode directional and formatting characters
 * (RLM, LRM, LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI, PDI, BOM, soft hyphen).
 */
export function stripUnicodeBidi(str: string): string {
  if (!str) return '';
  return str.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/g, '');
}

/**
 * Normalizes all non-standard whitespace (NBSP, Narrow NBSP, Thin Space, Figure Space)
 * to regular ASCII space (U+0020).
 */
export function normalizeSpaces(str: string): string {
  if (!str) return '';
  return str.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

/**
 * Converts Eastern Arabic (٠-٩) and Persian (۰-۹) digits to Latin ASCII digits (0-9).
 */
export function normalizeDigitCharacters(str: string): string {
  if (!str) return '';
  let result = str;
  for (let i = 0; i < 10; i++) {
    const digitStr = i.toString();
    result = result.replace(new RegExp(EASTERN_ARABIC_DIGITS[i], 'g'), digitStr);
    result = result.replace(new RegExp(PERSIAN_DIGITS[i], 'g'), digitStr);
  }
  return result;
}

/**
 * Full normalization for Bankak OCR text:
 * - Strips invisible Bidi/Unicode characters
 * - Normalizes non-breaking and special spaces to ASCII space
 * - Converts Eastern Arabic and Persian numerals to Latin 0-9
 * - Normalizes Arabic decimal separator (٫ U+066B) to dot (.)
 * - Normalizes Arabic thousands separators (٬ U+066C, ، U+060C) between digits to comma (,)
 *
 * Preserves ASCII dots (.), commas (,), apostrophes ('), and spaces so downstream
 * financial amount parsers can disambiguate thousands vs decimal separators safely.
 */
export function normalizeDigits(text: string): string {
  if (!text) return '';
  let result = stripUnicodeBidi(text);
  result = normalizeSpaces(result);
  result = normalizeDigitCharacters(result);

  // Normalize Arabic decimal separator (٫ U+066B) to standard dot (.)
  result = result.replace(/\u066B/g, '.');

  // Normalize Arabic thousands separators (٬ U+066C, ، U+060C) between digits to standard comma (,)
  result = result.replace(/(\d)[\u066C\u060C](\d)/g, '$1,$2');

  return result;
}
