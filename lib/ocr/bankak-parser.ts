import crypto from 'crypto';

export interface ParsedBankakReceipt {
  transactionId: string;
  amount: number;
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
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let result = text;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(arabicDigits[i], 'g'), i.toString());
  }
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

  // 1. Transaction ID
  let transactionId = '';
  const txnPatterns = [
    /(?:Transaction\s*(?:ID|No|Ref|Reference)|Ref(?:erence)?|TXN|رقم\s*(?:العملية|المرجع|الإشعار)|الرقم\s*المرجعي)[\s:]*([A-Za-z0-9\-_]+)/i,
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
  const amountPatterns = [
    /(?:Amount|المبلغ|القيمة|مبلغ\s*التحويل)[\s:]*([0-9]{1,3}(?:[,][0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i,
    /([0-9]{1,3}(?:[,][0-9]{3})+(?:\.[0-9]+)?)\s*(?:SDG|ج\.س|جنيه|SD|جنيه\s*سوداني)/i,
    /([0-9]{4,12}(?:\.[0-9]+)?)\s*(?:SDG|ج\.س)/i,
  ];
  for (const pattern of amountPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const cleanNum = match[1].replace(/,/g, '');
      const parsedVal = parseFloat(cleanNum);
      if (!isNaN(parsedVal) && parsedVal > 0) {
        amount = parsedVal;
        fieldsMatched++;
        break;
      }
    }
  }

  // 3. Sender Name
  let senderName = '';
  const senderPatterns = [
    /(?:Sender|From|المرسل|من\s*الحساب|اسم\s*المرسل|من\s*العميل)[\s:]*([^\n\r,:]+)/i,
  ];
  for (const pattern of senderPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1].trim().length > 2) {
      senderName = match[1].trim().split(/\s{2,}|[-|]/)[0].trim();
      fieldsMatched++;
      break;
    }
  }

  // 4. Sender Account
  let senderAccount = '';
  const senderAccPatterns = [
    /(?:Sender\s*Account|From\s*Account|رقم\s*حساب\s*المرسل|حساب\s*الخصم)[\s:]*([0-9\*\-]{6,20})/i,
  ];
  for (const pattern of senderAccPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      senderAccount = match[1].trim();
      fieldsMatched++;
      break;
    }
  }

  // 5. Receiver Name
  let receiverName = '';
  const receiverPatterns = [
    /(?:Beneficiary|Receiver|To|المستفيد|المستلم|إلى\s*حساب|اسم\s*المستفيد)[\s:]*([^\n\r,:]+)/i,
  ];
  for (const pattern of receiverPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1].trim().length > 2) {
      receiverName = match[1].trim().split(/\s{2,}|[-|]/)[0].trim();
      fieldsMatched++;
      break;
    }
  }

  // 6. Receiver Account
  let receiverAccount = '';
  const receiverAccPatterns = [
    /(?:Beneficiary\s*Account|To\s*Account|رقم\s*حساب\s*المستفيد|حساب\s*الإيداع)[\s:]*([0-9\*\-]{6,20})/i,
  ];
  for (const pattern of receiverAccPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      receiverAccount = match[1].trim();
      fieldsMatched++;
      break;
    }
  }

  // 7. Date
  let transactionDate = new Date().toISOString().split('T')[0];
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
          // YYYY-MM-DD
          transactionDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        } else if (parts[2].length === 4) {
          // DD-MM-YYYY
          transactionDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      }
      fieldsMatched++;
      break;
    }
  }

  // 8. Time
  let transactionTime = '12:00:00';
  const timePattern = /([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:\s*[AaPp][Mm])?)/;
  const timeMatch = normalized.match(timePattern);
  if (timeMatch) {
    transactionTime = timeMatch[1].trim();
    fieldsMatched++;
  }

  // Calculate confidence score (weighted out of 100)
  // Essential: transactionId (35%), amount (35%), date (10%), parties (20%)
  let confidence = 0;
  if (transactionId) confidence += 35;
  if (amount > 0) confidence += 35;
  if (transactionDate) confidence += 10;
  if (senderName || senderAccount) confidence += 10;
  if (receiverName || receiverAccount) confidence += 10;

  return {
    transactionId: transactionId || `TXN-${Date.now()}`,
    amount,
    currency: 'SDG',
    senderName: senderName || 'غير محدد',
    senderAccount: senderAccount || 'غير متوفر',
    receiverName: receiverName || 'مكتب الصرافة',
    receiverAccount: receiverAccount || 'حساب بنكك الرئيسي',
    transactionDate,
    transactionTime,
    bankName: 'بنكك - بنك الخرطوم (Bank of Khartoum)',
    ocrConfidence: confidence,
    rawText: rawInput,
    extractedFieldsCount: fieldsMatched,
  };
}
