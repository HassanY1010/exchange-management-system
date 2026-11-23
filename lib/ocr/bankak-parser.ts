import crypto from 'crypto';

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
}

/**
 * Normalizes Eastern Arabic numerals to Western digits (0-9)
 */
export function normalizeDigits(text: string): string {
  if (!text) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let result = text;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(arabicDigits[i], 'g'), i.toString());
  }
  // Normalize Arabic decimal separator (٫ U+066B) to standard dot (.)
  result = result.replace(/\u066B/g, '.');
  // Normalize Arabic thousands separators (٬ U+066C, ، U+060C) between digits to standard comma (,)
  result = result.replace(/(\d)[\u066C\u060C](\d)/g, '$1,$2');
  return result;
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
 * Extracts all required fields according to Bankak (Bank of Khartoum) format
 */
export function parseBankakReceiptText(rawInput: string): ParsedBankakReceipt {
  const normalized = normalizeDigits(rawInput || '');
  let fieldsMatched = 0;

  // Helper: clean and sanitize account number (strip prefixes, preserve leading zeros, remove spaces)
  const sanitizeAccount = (acc: string): string => {
    if (!acc) return '';
    let cleaned = acc.replace(/^(?:من\s*حساب|إلى\s*حساب|الى\s*حساب|حساب|من|إلى|الى|account|to|from)\s*[:\s]*/i, '');
    cleaned = cleaned.replace(/[^0-9]/g, '').trim();
    return cleaned;
  };

  // Helper: clean name and reject UI boilerplate or account strings
  const sanitizeName = (raw: string): string => {
    if (!raw) return '';
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^(?:اسم\s*المرسل\s*[إا]ليه|اسم\s*المستفيد|اسم\s*المرسل|اسم\s*العميل|المرسل\s*[إا]ليه|المستفيد|المستلم|المرسل|من|إلى|الى)\s*[:\s]*/i, '');
    cleaned = cleaned.split(/\s{2,}|[-|\n\r]/)[0].trim();
    if (
      !cleaned ||
      /^(?:حساب|الحساب|من\s*حساب|[إا]لى\s*حساب|account|n\/a|تحويلات|بنك|مشاركة|طباعة|تحميل|إضافة|التعليق)/i.test(cleaned) ||
      /^[0-9\s\*\-]+$/.test(cleaned) ||
      cleaned.length <= 2
    ) {
      return '';
    }
    return cleaned;
  };

  // 1. Transaction ID
  let transactionId = '';
  const txnPatterns = [
    /(?:Transaction\s*(?:ID|No|Ref|Reference)|Ref(?:erence)?|TXN|رقم\s*(?:العملية|المرجع|الإشعار|المعاملة)|الرقم\s*المرجعي|معرف\s*العملية)[\s:]*([A-Za-z0-9\-_]+)/i,
    /(FT[0-9]{8,20})/i,
    /([0-9]{9,16})/,
  ];
  for (const pattern of txnPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      transactionId = match[1] || match[0];
      fieldsMatched++;
      break;
    }
  }

  // 2. Amount
  let amount = 0;
  let amountNeedsReview = true;
  const amountPatterns = [
    /(?:Amount|المبلغ|القيمة|مبلغ\s*التحويل|مبلغ\s*العملية)[\s:]*([0-9]{1,3}(?:\s*[,]\s*[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i,
    /([0-9]{1,3}(?:\s*[,]\s*[0-9]{3})+(?:\.[0-9]+)?)\s*(?:SDG|ج\.س|جنيه|SD|جنيه\s*سوداني)/i,
    /([0-9]{4,12}(?:\.[0-9]+)?)\s*(?:SDG|ج\.س|جنيه)/i,
    /(?:SDG|ج\.س|جنيه)[\s:]*([0-9]{1,3}(?:\s*[,]\s*[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const pattern of amountPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const cleanNum = match[1].replace(/[\s,]/g, '');
      const parsedVal = parseFloat(cleanNum);
      if (!isNaN(parsedVal) && parsedVal > 0) {
        amount = parsedVal;
        amountNeedsReview = false;
        fieldsMatched++;
        break;
      }
    }
  }

  // 3. Sender Name
  let senderName = '';
  const senderPatterns = [
    /(?:اسم\s*المرسل|اسم\s*العميل|\bSender(?:\s*Name)?\b)[\s:]*([^\n\r,:\d][^\n\r,:]*)/i,
    /(?:من)[\s:]+(?!(?:حساب|الحساب|[0-9]))([^\n\r,:\d][^\n\r,:]*)/i,
  ];
  for (const pattern of senderPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const cleaned = sanitizeName(match[1]);
      if (cleaned) {
        senderName = cleaned;
        fieldsMatched++;
        break;
      }
    }
  }

  // 4. Sender Account
  let senderAccount = '';
  const senderAccPatterns = [
    /(?:\bSender\s*Account\b|\bFrom\s*Account\b|(?:رقم\s*)?حساب\s*المرسل|حساب\s*الخصم|من\s*الحساب|من\s*حساب|(?:رقم\s*)?(?:هاتف|موبايل|جوال)\s*المرسل)[\s:]*([0-9\*\-](?:[0-9\*\-\s]{4,28}[0-9\*\-]|[0-9\*\-]{4,20}))/i,
  ];
  for (const pattern of senderAccPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const cleanAcc = sanitizeAccount(match[1]);
      if (cleanAcc.length >= 6) {
        senderAccount = cleanAcc;
        fieldsMatched++;
        break;
      }
    }
  }

  // 5. Receiver Name (Beneficiary)
  let receiverName = '';
  const receiverPatterns = [
    /(?:اسم\s*المرسل\s*[إا]ليه|اسم\s*المستفيد|\bBeneficiary(?:\s*Name)?\b|\bRecipient(?:\s*Name)?\b)[\s:]*([^\n\r,:\d][^\n\r,:]*)/i,
    /(?:المرسل\s*[إا]ليه|المستفيد|المستلم)[\s:]+(?!(?:حساب|الحساب|[0-9]))([^\n\r,:\d][^\n\r,:]*)/i,
    /(?:إلى|الى)[\s:]+(?!(?:حساب|الحساب|[0-9]))([^\n\r,:\d][^\n\r,:]*)/i,
  ];
  for (const pattern of receiverPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const cleaned = sanitizeName(match[1]);
      if (cleaned) {
        receiverName = cleaned;
        fieldsMatched++;
        break;
      }
    }
  }

  // 6. Receiver Account
  let receiverAccount = '';
  const receiverAccPatterns = [
    /(?:\bBeneficiary\s*Account\b|\bTo\s*Account\b|(?:رقم\s*)?حساب\s*المستفيد|حساب\s*الإيداع|[إا]لى\s*الحساب|[إا]لى\s*حساب|(?:رقم\s*)?(?:هاتف|موبايل|جوال)\s*المستفيد)[\s:]*([0-9\*\-](?:[0-9\*\-\s]{4,28}[0-9\*\-]|[0-9\*\-]{4,20}))/i,
  ];
  for (const pattern of receiverAccPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const cleanAcc = sanitizeAccount(match[1]);
      if (cleanAcc.length >= 6) {
        receiverAccount = cleanAcc;
        fieldsMatched++;
        break;
      }
    }
  }

  // 7. Date & Time
  let dateMatched = false;
  let transactionDate = '';

  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    'يناير': '01', 'فبراير': '02', 'مارس': '03', 'أبريل': '04', 'ابريل': '04',
    'مايو': '05', 'يونيو': '06', 'يوليو': '07', 'أغسطس': '08', 'اغسطس': '08',
    'سبتمبر': '09', 'أكتوبر': '10', 'اكتوبر': '10', 'نوفمبر': '11', 'ديسمبر': '12',
  };

  // Check named month format: e.g. "16-Nov-2026" or "15 Nov 2026"
  const namedDateMatch = normalized.match(/([0-9]{1,2})[\s\-\/\.]([A-Za-z\u0621-\u064A]{3,9})[\s\-\/\.]([0-9]{4})/i);
  if (namedDateMatch) {
    const d = namedDateMatch[1].padStart(2, '0');
    const mKey = namedDateMatch[2].toLowerCase();
    const y = namedDateMatch[3];
    const m = monthMap[mKey];
    if (m) {
      transactionDate = `${y}-${m}-${d}`;
      dateMatched = true;
      fieldsMatched++;
    }
  }

  if (!dateMatched) {
    const datePatterns = [
      /(?:Date|التاريخ|تاريخ\s*العملية)[\s:]*([0-9]{1,4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,4})/i,
      /([0-9]{2}[\/\-\.][0-9]{2}[\/\-\.][0-9]{4})/,
      /([0-9]{4}[\/\-\.][0-9]{2}[\/\-\.][0-9]{2})/,
    ];
    for (const pattern of datePatterns) {
      const match = normalized.match(pattern);
      if (match) {
        const rawDate = match[1].replace(/[\/\.]/g, '-');
        const parts = rawDate.split('-');
        if (parts.length === 3) {
          if (parts[0].length === 4) {
            transactionDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            dateMatched = true;
          } else if (parts[2].length === 4) {
            transactionDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            dateMatched = true;
          }
        }
        if (dateMatched) {
          fieldsMatched++;
          break;
        }
      }
    }
  }

  if (!transactionDate) {
    transactionDate = new Date().toISOString().split('T')[0];
  }

  // 8. Time
  let transactionTime = '';
  const timePattern = /([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:\s*[AaPp][Mm])?)/;
  const timeMatch = normalized.match(timePattern);
  if (timeMatch) {
    transactionTime = timeMatch[1].trim();
    fieldsMatched++;
  } else {
    transactionTime = '12:00:00';
  }

  // Calculate confidence score (weighted out of 100)
  // Essential: transactionId (35%), amount (35%), date (10%), parties (20%)
  let confidence = 0;
  if (transactionId) confidence += 35;
  if (amount > 0 && !amountNeedsReview) confidence += 35;
  if (dateMatched) confidence += 10;
  if (senderName || senderAccount) confidence += 10;
  if (receiverName || receiverAccount) confidence += 10;

  return {
    transactionId: transactionId || '',
    amount,
    amountNeedsReview,
    currency: 'SDG',
    senderName: senderName || '',
    senderAccount: senderAccount || '',
    receiverName: receiverName || '',
    receiverAccount: receiverAccount || '',
    transactionDate,
    transactionTime,
    bankName: 'بنكك - بنك الخرطوم (Bank of Khartoum)',
    ocrConfidence: confidence,
    rawText: rawInput,
    extractedFieldsCount: fieldsMatched,
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
