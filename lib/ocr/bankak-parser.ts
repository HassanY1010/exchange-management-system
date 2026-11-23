import crypto from 'crypto';

export interface ConfidenceBreakdown {
  transactionIdConfidence: number; // 0 - 25
  amountConfidence: number;        // 0 - 25
  recipientConfidence: number;     // 0 - 25
  accountConfidence: number;       // 0 - 15
  dateConfidence: number;          // 0 - 10
  overall: number;                 // 0 - 100
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
  dateValid?: boolean;
  accountsValid?: boolean;
  confidenceBreakdown?: ConfidenceBreakdown;
}

/**
 * Clean invisible Unicode directional characters (RLM, LRM, LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI, PDI)
 */
export function stripUnicodeBidi(str: string): string {
  if (!str) return '';
  return str.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
}

/**
 * Normalizes Eastern Arabic numerals to Western digits (0-9) and standardizes separators
 */
export function normalizeDigits(text: string): string {
  if (!text) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let result = stripUnicodeBidi(text);
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(arabicDigits[i], 'g'), i.toString());
  }
  // Normalize Arabic decimal separator (٫ U+066B) to standard dot (.)
  result = result.replace(/\u066B/g, '.');
  // Normalize Arabic thousands separators (٬ U+066C, ، U+060C) between digits to standard comma (,)
  result = result.replace(/(\d)[\u066C\u060C](\d)/g, '$1,$2');
  return result;
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
    // If it's a base64 data URL, strip header
    const cleanBase64 = bufferOrBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    hash.update(cleanBase64);
  } else {
    hash.update(bufferOrBase64);
  }
  return hash.digest('hex');
}

/**
 * Intelligent rule-based and regex-based Bankak Receipt Parser
 * Strictly extracts all required fields according to Bankak (Bank of Khartoum) format
 */
export function parseBankakReceiptText(rawInput: string): ParsedBankakReceipt {
  const normalized = normalizeDigits(rawInput || '');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  let fieldsMatched = 0;

  // Helper: clean beneficiary / name and reject boilerplate, accounts, or single words
  const cleanName = (raw: string): string => {
    if (!raw) return '';
    let c = raw.trim();
    // Strip common labels and OCR artifacts (eee, ere, ofc, ooo, Jara eal, etc.)
    c = c.replace(/^(?:[إأآا]?سم\s*(?:المرسل\s*[إأآا]?لي[هة]|المرسل|المستفيد|المستلم)|المرسل\s*[إأآا]?لي[هة]|المستفيد|المستلم|[إا]لى|Jara\s*eal|eal|[eE]{2,4}|[oO]{2,4}|ofc|ere)[\s:]*/i, '');
    c = c.replace(/^[a-zA-Z\s]{1,6}\s+/i, ''); // Strip stray English letters
    c = c.replace(/^[ا-ي]\s+امل\s+/i, ''); // Tesseract artifact where "إسم المرسل اليه" is misread as "ا امل"
    c = c.split(/\s{2,}|[-|\n\r]/)[0].trim();
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

  // 1. Transaction ID (Strict 10-16 digits, NOT a date or time)
  let transactionId = '';
  const txnLabeled = normalized.match(/(?:Transaction\s*(?:ID|No|Ref|Reference)|رقم\s*(?:العملية|المرجع|الإشعار|المعاملة)|الرقم\s*المرجعي|معرف\s*العملية)[\s:]*([A-Za-z0-9\-_]+)/i);
  if (txnLabeled && txnLabeled[1]) {
    const val = txnLabeled[1].replace(/[^0-9A-Za-z]/g, '');
    if (val.length >= 8 && !/^[0-9]{1,2}-[A-Za-z]{3}/.test(val)) {
      transactionId = val;
    }
  }
  if (!transactionId) {
    // Standard Bank of Khartoum 11-digit reference starting with 20 or 21
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
  // Note: Bankak receipts ONLY print the recipient's name ("إسم المرسل إليه"). They NEVER print the sender's name!
  let receiverName = '';
  // Strategy A: Labeled beneficiary line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:[إأآا]?سم\s*المرسل(?:\s*[إأآا]?لي[هة])?|[إأآا]?سم\s*المستفيد|المستفيد\b|المرسل\s*[إأآا]?لي[هة])/i.test(line)) {
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

  // Strategy B: Positional extraction (located between "إلى حساب" and "المبلغ" / "رقم الموبايل")
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

  // Fallback for noisy OCR artifact where label was misread as 'ا امل تبيان عبد الرحيم...'
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

  // 3. Amount
  let amount = 0;
  let amountValid = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:المبلغ|القيمة|مبلغ\s*التحويل|مبلغ\s*العملية|Amount)/i.test(line)) {
      // Same line
      const sameMatch = line.match(/(?:المبلغ|القيمة|مبلغ\s*التحويل|مبلغ\s*العملية|Amount)[\s:]*([0-9]{1,3}(?:[,.][0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i);
      if (sameMatch && sameMatch[1]) {
        const parsedVal = parseFloat(sameMatch[1].replace(/,/g, ''));
        if (parsedVal > 0) {
          amount = parsedVal;
          amountValid = true;
          break;
        }
      }
      // Next line
      if (i + 1 < lines.length) {
        const nextMatch = lines[i + 1].match(/^([0-9]{1,3}(?:[,.][0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/);
        if (nextMatch && nextMatch[1]) {
          const parsedVal = parseFloat(nextMatch[1].replace(/,/g, ''));
          if (parsedVal > 0) {
            amount = parsedVal;
            amountValid = true;
            break;
          }
        }
      }
    }
  }

  // Fallback for amount with currency symbol
  if (!amountValid) {
    const amountFallback =
      normalized.match(/([0-9]{1,3}(?:[,][0-9]{3})+(?:\.[0-9]+)?)\s*(?:SDG|ج\.س|جنيه)/i) ||
      normalized.match(/(?:SDG|ج\.س|جنيه)[\s:]*([0-9]{1,3}(?:[,][0-9]{3})+(?:\.[0-9]+)?)/i);
    if (amountFallback) {
      const parsedVal = parseFloat(amountFallback[1].replace(/,/g, ''));
      if (parsedVal > 0) {
        amount = parsedVal;
        amountValid = true;
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
  let senderName = '';

  // 6. Date & Time Validation
  let dateMatched = false;
  let transactionDate = '';
  let transactionTime = '';

  // Time extraction
  const timeMatch = normalized.match(/([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:\s*[AaPp][Mm])?)/);
  if (timeMatch) {
    transactionTime = timeMatch[1].trim();
    fieldsMatched++;
  }

  // Strict named month date: e.g. "17-Nov-2026", "16-Nov-2026", "15 Nov 2026"
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

  // Strict numeric date fallback: e.g. 2026-11-16 or 16/11/2026
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

  // 7. Calculate Granular Confidence Breakdown
  const receiverNameValid = Boolean(receiverName && receiverName.length > 3);
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

  return {
    transactionId: transactionId || '',
    amount,
    amountNeedsReview: !amountValid || amount <= 0,
    currency: 'SDG',
    senderName: senderName || '',
    senderAccount: senderAccount || '',
    receiverName: receiverName || '',
    receiverAccount: receiverAccount || '',
    transactionDate,
    transactionTime: transactionTime || '12:00:00',
    bankName: 'بنكك - بنك الخرطوم (Bank of Khartoum)',
    ocrConfidence: confidenceBreakdown.overall,
    rawText: rawInput,
    extractedFieldsCount: fieldsMatched,
    amountValid,
    receiverNameValid,
    dateValid: dateMatched,
    accountsValid,
    confidenceBreakdown,
  };
}

/**
 * Merges best extracted fields from multi-mode OCR passes (e.g. PSM 4 and PSM 11)
 */
export function mergeParsedResults(p1: ParsedBankakReceipt, p2: ParsedBankakReceipt): ParsedBankakReceipt {
  const isP1TxnValid = Boolean(p1.transactionId && p1.transactionId.length >= 8 && !/^[0-9]{1,2}-[A-Za-z]{3}/.test(p1.transactionId));
  const isP2TxnValid = Boolean(p2.transactionId && p2.transactionId.length >= 8 && !/^[0-9]{1,2}-[A-Za-z]{3}/.test(p2.transactionId));
  const transactionId = isP1TxnValid ? p1.transactionId : (isP2TxnValid ? p2.transactionId : '');

  const amountValid = p1.amountValid || p2.amountValid;
  const amount = p1.amountValid ? p1.amount : (p2.amountValid ? p2.amount : 0);

  const receiverName = p1.receiverNameValid ? p1.receiverName : (p2.receiverNameValid ? p2.receiverName : '');
  const receiverNameValid = Boolean(receiverName && receiverName.length > 3);

  const senderName = p1.senderName || p2.senderName || '';
  const senderAccount = (p1.senderAccount && p1.senderAccount.length >= 6) ? p1.senderAccount : (p2.senderAccount || '');
  const receiverAccount = (p1.receiverAccount && p1.receiverAccount.length >= 6) ? p1.receiverAccount : (p2.receiverAccount || '');
  const accountsValid = Boolean(senderAccount.length >= 6 || receiverAccount.length >= 6);

  const dateValid = p1.dateValid || p2.dateValid;
  const transactionDate = p1.dateValid ? p1.transactionDate : (p2.dateValid ? p2.transactionDate : '');
  const transactionTime = p1.transactionTime && p1.transactionTime !== '12:00:00' ? p1.transactionTime : (p2.transactionTime || '12:00:00');

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

  return {
    transactionId: transactionId || '',
    amount,
    amountNeedsReview: !amountValid || amount <= 0,
    currency: 'SDG',
    senderName,
    senderAccount,
    receiverName,
    receiverAccount,
    transactionDate,
    transactionTime,
    bankName: 'بنكك - بنك الخرطوم (Bank of Khartoum)',
    ocrConfidence: confidenceBreakdown.overall,
    rawText: `${p1.rawText}\n--- Secondary OCR ---\n${p2.rawText}`,
    extractedFieldsCount: Math.max(p1.extractedFieldsCount, p2.extractedFieldsCount),
    amountValid,
    receiverNameValid,
    dateValid,
    accountsValid,
    confidenceBreakdown,
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
  // 1. Exact Duplicate Check (Transaction ID or Image Hash)
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

  // 2. Suspicious Heuristic Match (Same amount, same date, similar sender name)
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
      senderA === 'غير محدد' || senderB === 'غير محدد' ||
      senderA === 'Unknown' || senderB === 'Unknown' ||
      senderA === 'غير معروف' || senderB === 'غير معروف';
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
