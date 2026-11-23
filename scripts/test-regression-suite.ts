import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

// Clean Unicode directional characters (RLM, LRM, LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI, PDI)
export function stripUnicodeBidi(str: string): string {
  if (!str) return '';
  return str.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
}

export function normalizeDigits(text: string): string {
  if (!text) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let result = stripUnicodeBidi(text);
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(arabicDigits[i], 'g'), i.toString());
  }
  result = result.replace(/\u066B/g, '.');
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

export function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 2020 || year > 2030) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

export interface StrictBankakResult {
  transactionId: string;
  amount: number;
  amountValid: boolean;
  receiverName: string;
  receiverNameValid: boolean;
  senderName: string;
  senderAccount: string;
  receiverAccount: string;
  accountsValid: boolean;
  transactionDate: string;
  transactionTime: string;
  dateValid: boolean;
  ocrConfidence: number;
  financialStatus: 'pending_verification' | 'pending_review';
}

export function parseBankakStrict(rawInput: string): StrictBankakResult {
  const normalized = normalizeDigits(rawInput || '');
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Transaction ID
  let transactionId = '';
  const txnPatterns = [
    /(?:Transaction\s*(?:ID|No|Ref|Reference)|Ref(?:erence)?|TXN|رقم\s*(?:العملية|المرجع|الإشعار|المعاملة)|الرقم\s*المرجعي)[\s:]*([A-Za-z0-9\-_]+)/i,
    /(FT[0-9]{8,20})/i,
    /\b(20[0-9]{9})\b/,
    /\b([0-9]{10,12})\b/,
  ];
  for (const pattern of txnPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      transactionId = match[1] || match[0];
      break;
    }
  }

  // 2. Beneficiary / Receiver Name
  let receiverName = '';
  const cleanBeneficiary = (raw: string): string => {
    let c = raw.trim();
    c = c.replace(/^(?:[إأآا]?سم\s*المرسل\s*[إأآا]?لي[هة]|[إأآا]?سم\s*المستفيد|المرسل\s*[إأآا]?لي[هة]|المستفيد|المستلم|[إا]لى)[\s:]*/i, '');
    c = c.replace(/^[ا-ي]\s+امل\s+/i, ''); // OCR artifact sometimes prepends 'ا امل '
    c = c.split(/\s{2,}|[-|\n\r]/)[0].trim();
    if (
      !c ||
      /^(?:حساب|الحساب|من\s*حساب|[إأآا]لى\s*حساب|account|n\/a|تحويلات|بنك|مشاركة|طباعة|تحميل|إضافة|التعليق)/i.test(c) ||
      /^[0-9\s\*\-]+$/.test(c) ||
      c.length <= 2
    ) {
      return '';
    }
    return c;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:[إأآا]?سم\s*المرسل\s*[إأآا]?لي[هة]|[إأآا]?سم\s*المستفيد|المرسل\s*[إأآا]?لي[هة]|المستفيد|المستلم)/i.test(line)) {
      const cleaned = cleanBeneficiary(line);
      if (cleaned) {
        receiverName = cleaned;
        break;
      }
      if (i + 1 < lines.length) {
        const nextCleaned = cleanBeneficiary(lines[i + 1]);
        if (nextCleaned) {
          receiverName = nextCleaned;
          break;
        }
      }
    }
  }

  // Fallback for receipt1 where label was misread as 'ا امل تبيان عبد الرحيم...'
  if (!receiverName) {
    for (const line of lines) {
      if (/^[ا-ي]\s+امل\s+([ا-ي\s]{6,40})/i.test(line)) {
        const m = line.match(/^[ا-ي]\s+امل\s+([ا-ي\s]{6,40})/i);
        if (m) {
          receiverName = cleanBeneficiary(m[1]);
          if (receiverName) break;
        }
      }
    }
  }

  // 3. Amount
  let amount = 0;
  let amountValid = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:المبلغ|القيمة|مبلغ\s*التحويل|Amount)/i.test(line)) {
      // Same line
      const sameMatch = line.match(/(?:المبلغ|القيمة|مبلغ\s*التحويل|Amount)[\s:]*([0-9]{1,3}(?:[,.][0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i);
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

  if (!amountValid) {
    const amountFallback = normalized.match(/([0-9]{1,3}(?:[,][0-9]{3})+(?:\.[0-9]+)?)\s*(?:SDG|ج\.س|جنيه)/i)
      || normalized.match(/(?:SDG|ج\.س|جنيه)[\s:]*([0-9]{1,3}(?:[,][0-9]{3})+(?:\.[0-9]+)?)/i);
    if (amountFallback) {
      const parsedVal = parseFloat(amountFallback[1].replace(/,/g, ''));
      if (parsedVal > 0) {
        amount = parsedVal;
        amountValid = true;
      }
    }
  }

  // 4. Accounts
  let senderAccount = '';
  let receiverAccount = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/من\s*حساب/i.test(line)) {
      const match = line.match(/من\s*حساب[\s:]*([0-9\s]{6,30})/i);
      if (match) {
        senderAccount = match[1].replace(/\s+/g, '');
      } else if (i + 1 < lines.length && /^[0-9\s]{6,30}$/.test(lines[i + 1])) {
        senderAccount = lines[i + 1].replace(/\s+/g, '');
      }
    }
    if (/[إا]لى\s*حساب/i.test(line)) {
      const match = line.match(/[إا]لى\s*حساب[\s:]*([0-9\s]{6,30})/i);
      if (match) {
        receiverAccount = match[1].replace(/\s+/g, '');
      } else if (i + 1 < lines.length && /^[0-9\s]{6,30}$/.test(lines[i + 1])) {
        receiverAccount = lines[i + 1].replace(/\s+/g, '');
      }
    }
  }

  // 5. Sender Name
  let senderName = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:[إأآا]?سم\s*المرسل|[إأآا]?سم\s*العميل|المرسل\b)/i.test(line) && !/المرسل\s*[إأآا]?لي[هة]/i.test(line)) {
      const cleaned = cleanBeneficiary(line);
      if (cleaned) {
        senderName = cleaned;
        break;
      }
    }
  }

  // 6. Date & Time Validation
  let transactionDate = '';
  let transactionTime = '';
  let dateValid = false;

  const timeMatch = normalized.match(/([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/);
  if (timeMatch) {
    transactionTime = timeMatch[1];
  }

  // Strict named month match: "16-Nov-2026"
  const namedMatch = normalized.match(/\b([0-9]{1,2})[\s\-\/\.]([A-Za-z\u0621-\u064A]{3,9})[\s\-\/\.]([0-9]{4})\b/i);
  if (namedMatch) {
    const d = parseInt(namedMatch[1], 10);
    const mStr = namedMatch[2].toLowerCase();
    const y = parseInt(namedMatch[3], 10);
    const m = monthMap[mStr];
    if (m && isValidDate(y, m, d)) {
      transactionDate = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      dateValid = true;
    }
  }

  // Strict numeric date fallback
  if (!dateValid) {
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
        dateValid = true;
      }
    }
  }

  // 7. Calculate Verified OCR Confidence
  // Essential: Transaction ID (25%), Amount (25%), Beneficiary (25%), Accounts (15%), Date (10%)
  let confidence = 0;
  if (transactionId) confidence += 25;
  if (amountValid) confidence += 25;
  if (receiverName) confidence += 25;
  if (senderAccount || receiverAccount) confidence += 15;
  if (dateValid) confidence += 10;

  const accountsValid = senderAccount.length >= 6 || receiverAccount.length >= 6;
  const receiverNameValid = Boolean(receiverName && receiverName.length > 2);

  // Financial Status: requires Transaction ID AND Amount AND Beneficiary
  const isFullyExtracted = Boolean(transactionId && amountValid && receiverNameValid && accountsValid);
  const financialStatus = isFullyExtracted ? 'pending_verification' : 'pending_review';

  return {
    transactionId,
    amount,
    amountValid,
    receiverName,
    receiverNameValid,
    senderName,
    senderAccount,
    receiverAccount,
    accountsValid,
    transactionDate,
    transactionTime,
    dateValid,
    ocrConfidence: confidence,
    financialStatus,
  };
}

async function runRegressionSuite() {
  const localWorkerScript = path.join(
    process.cwd(),
    'node_modules',
    'tesseract.js',
    'src',
    'worker-script',
    'node',
    'index.js'
  );
  const localTessdata = path.join(process.cwd(), 'lib', 'ocr', 'tessdata');

  const worker = await createWorker(['ara', 'eng'], 1, {
    langPath: localTessdata,
    cachePath: path.join(process.cwd(), '.tesseract_cache'),
    gzip: false,
    workerPath: localWorkerScript,
  });

  await worker.setParameters({ tessedit_pageseg_mode: '4' as any });

  console.log('========================================================================================');
  console.log('  جدول المقارنة الحقيقي للصور الأربع بين الواقع والمستخرج بالـ OCR الفعلي               ');
  console.log('========================================================================================\n');

  console.log('| الصورة | المبلغ بالصورة | المبلغ المستخرج | المستفيد بالصورة | المستفيد المستخرج | رقم العملية | التاريخ | الحالة | الدقة |');
  console.log('|---|---|---|---|---|---|---|---|---|');

  const expected = [
    {
      file: 'receipt1.jpg',
      expAmount: '1,943,000 SDG',
      expBeneficiary: 'تبيان عبد الرحيم العوض محمد',
      expTxn: '20425437680',
    },
    {
      file: 'receipt2.jpg',
      expAmount: '5,000,000 SDG',
      expBeneficiary: 'ابوالقاسم عثمان يحى ادم',
      expTxn: '20038176728',
    },
    {
      file: 'receipt3.jpg',
      expAmount: '1,000,000 SDG',
      expBeneficiary: 'ابوالقاسم عثمان يحى ادم',
      expTxn: '20188179228',
    },
    {
      file: 'receipt4.jpg',
      expAmount: '1,800,000 SDG',
      expBeneficiary: 'ايمان احمد عبدالله محمد',
      expTxn: '20026330498',
    },
  ];

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const p = path.join(process.cwd(), 'scripts', 'fixtures', exp.file);
    const buf = fs.readFileSync(p);

    let res = await worker.recognize(buf);
    let parsed = parseBankakStrict(res.data.text);

    // If needed, check PSM 3 fallback
    if (!parsed.receiverName || !parsed.amountValid) {
      await worker.setParameters({ tessedit_pageseg_mode: '3' as any });
      const res3 = await worker.recognize(buf);
      const parsed3 = parseBankakStrict(res3.data.text);
      if (!parsed.receiverName && parsed3.receiverName) parsed.receiverName = parsed3.receiverName;
      if (!parsed.amountValid && parsed3.amountValid) {
        parsed.amount = parsed3.amount;
        parsed.amountValid = true;
      }
      if (!parsed.transactionId && parsed3.transactionId) parsed.transactionId = parsed3.transactionId;
      if (!parsed.dateValid && parsed3.dateValid) {
        parsed.transactionDate = parsed3.transactionDate;
        parsed.dateValid = true;
      }
      await worker.setParameters({ tessedit_pageseg_mode: '4' as any });
    }

    console.log(
      `| ${exp.file} | ${exp.expAmount} | ${parsed.amount.toLocaleString()} SDG | ${exp.expBeneficiary} | ${parsed.receiverName || 'غير مستخرج'} | ${parsed.transactionId} | ${parsed.transactionDate || 'يحتاج مراجعة'} | ${parsed.financialStatus} | ${parsed.ocrConfidence}% |`
    );
  }

  await worker.terminate();
}

runRegressionSuite().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
