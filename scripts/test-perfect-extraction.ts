import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

// Month dictionary
const monthMap: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4,
  'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8,
  'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 2020 || year > 2030) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

export function parseReceiptV2(rawInput: string) {
  // Normalize digits
  let text = rawInput || '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  for (let i = 0; i < 10; i++) {
    text = text.replace(new RegExp(arabicDigits[i], 'g'), i.toString());
  }
  text = text.replace(/\u066B/g, '.');
  text = text.replace(/(\d)[\u066C\u060C](\d)/g, '$1,$2');

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Transaction ID
  let transactionId = '';
  const txnMatch = text.match(/(?:Transaction\s*(?:ID|No|Ref)|رقم\s*العملية|الرقم\s*المرجعي)[\s:]*([A-Za-z0-9\-_]+)/i)
    || text.match(/(FT[0-9]{8,20})/i)
    || text.match(/\b(20[0-9]{9})\b/)
    || text.match(/\b([0-9]{10,12})\b/);
  if (txnMatch) {
    transactionId = txnMatch[1];
  }

  // 2. Amount
  let amount = 0;
  let amountNeedsReview = true;
  // Match "المبلغ" followed by number on same line or next line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?:المبلغ|القيمة|مبلغ\s*التحويل|Amount)/i.test(line)) {
      // Check same line
      const sameLineMatch = line.match(/(?:المبلغ|القيمة|مبلغ\s*التحويل|Amount)[\s:]*([0-9]{1,3}(?:[,.][0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i);
      if (sameLineMatch && sameLineMatch[1]) {
        const val = parseFloat(sameLineMatch[1].replace(/,/g, ''));
        if (val > 0) {
          amount = val;
          amountNeedsReview = false;
          break;
        }
      }
      // Check next line
      if (i + 1 < lines.length) {
        const nextLineMatch = lines[i + 1].match(/^([0-9]{1,3}(?:[,.][0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/);
        if (nextLineMatch) {
          const val = parseFloat(nextLineMatch[1].replace(/,/g, ''));
          if (val > 0) {
            amount = val;
            amountNeedsReview = false;
            break;
          }
        }
      }
    }
  }
  // Fallback pattern if not found by label
  if (amount <= 0) {
    const amountRegex = /(?:SDG|ج\.س|جنيه)[\s:]*([0-9]{1,3}(?:[,][0-9]{3})+(?:\.[0-9]+)?)/i;
    const m = text.match(amountRegex);
    if (m) {
      amount = parseFloat(m[1].replace(/,/g, ''));
      amountNeedsReview = false;
    }
  }

  // 3. Accounts: sender (من حساب) and receiver (الى حساب)
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

  // 4. Beneficiary Name (إسم المرسل اليه / اسم المستفيد)
  let receiverName = '';
  const cleanNameToken = (raw: string): string => {
    let c = raw.trim();
    c = c.replace(/^(?:[إأآا]?سم\s*المرسل\s*[إأآا]?لي[هة]|[إأآا]?سم\s*المستفيد|المرسل\s*[إأآا]?لي[هة]|المستفيد|المستلم)[\s:]*/i, '');
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
      const cleaned = cleanNameToken(line);
      if (cleaned) {
        receiverName = cleaned;
        break;
      }
      // Check next line
      if (i + 1 < lines.length) {
        const nextCleaned = cleanNameToken(lines[i + 1]);
        if (nextCleaned) {
          receiverName = nextCleaned;
          break;
        }
      }
    }
  }

  // 5. Sender Name (if explicitly labeled)
  let senderName = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:[إأآا]?سم\s*المرسل|[إأآا]?سم\s*العميل|المرسل\b)/i.test(line) && !/المرسل\s*[إأآا]?لي[هة]/i.test(line)) {
      const cleaned = cleanNameToken(line);
      if (cleaned) {
        senderName = cleaned;
        break;
      }
    }
  }

  // 6. Date & Time Validation
  let transactionDate = '';
  let transactionTime = '';
  let dateNeedsReview = false;

  // Time extraction
  const timeMatch = text.match(/([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/);
  if (timeMatch) {
    transactionTime = timeMatch[1];
  }

  // Named month match: e.g. "16-Nov-2026" or "15-Nov-2026"
  const namedMatch = text.match(/\b([0-9]{1,2})[\s\-\/\.]([A-Za-z\u0621-\u064A]{3,9})[\s\-\/\.]([0-9]{4})\b/i);
  if (namedMatch) {
    const d = parseInt(namedMatch[1], 10);
    const mStr = namedMatch[2].toLowerCase();
    const y = parseInt(namedMatch[3], 10);
    const m = monthMap[mStr];
    if (m && isValidDate(y, m, d)) {
      transactionDate = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    }
  }

  // Numeric date fallback: DD-MM-YYYY or YYYY-MM-DD
  if (!transactionDate) {
    const numMatch = text.match(/\b([0-9]{1,4})[\/\-\.]([0-9]{1,2})[\/\-\.]([0-9]{1,4})\b/);
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
      }
    }
  }

  if (!transactionDate) {
    dateNeedsReview = true;
    transactionDate = ''; // Do NOT invent a fake date or today's date!
  }

  return {
    transactionId,
    amount,
    amountNeedsReview,
    receiverName,
    senderName,
    senderAccount,
    receiverAccount,
    transactionDate,
    transactionTime,
    dateNeedsReview,
  };
}

async function testAllFourImages() {
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

  // Set PSM 4: single column of variable text sizes - optimal for mobile receipts
  await worker.setParameters({
    tessedit_pageseg_mode: '4' as any,
  });

  console.log('========================================================================================');
  console.log('  فحص نتائج استخراج الحقول للصور الأربع الحقيقية (Real Images Verification)              ');
  console.log('========================================================================================\n');

  for (let i = 1; i <= 4; i++) {
    const filename = `receipt${i}.jpg`;
    const p = path.join(process.cwd(), 'scripts', 'fixtures', filename);
    const buf = fs.readFileSync(p);

    let res = await worker.recognize(buf);
    let parsed = parseReceiptV2(res.data.text);

    // If beneficiary or amount was missed in PSM 4, try PSM 3 as smart fallback
    if (!parsed.receiverName || parsed.amount <= 0) {
      await worker.setParameters({ tessedit_pageseg_mode: '3' as any });
      const res3 = await worker.recognize(buf);
      const parsed3 = parseReceiptV2(res3.data.text);
      if (!parsed.receiverName && parsed3.receiverName) parsed.receiverName = parsed3.receiverName;
      if (parsed.amount <= 0 && parsed3.amount > 0) {
        parsed.amount = parsed3.amount;
        parsed.amountNeedsReview = false;
      }
      if (!parsed.transactionId && parsed3.transactionId) parsed.transactionId = parsed3.transactionId;
      if (!parsed.transactionDate && parsed3.transactionDate) parsed.transactionDate = parsed3.transactionDate;
      // Reset back to 4
      await worker.setParameters({ tessedit_pageseg_mode: '4' as any });
    }

    console.log(`\n--- الصورة ${i}: ${filename} ---`);
    console.log(`رقم العملية:   ${parsed.transactionId}`);
    console.log(`المبلغ:        ${parsed.amount.toLocaleString()} SDG (يحتاج مراجعة: ${parsed.amountNeedsReview})`);
    console.log(`المستفيد:      ${parsed.receiverName || 'غير مستخرج (يحتاج مراجعة)'}`);
    console.log(`حساب المستفيد: ${parsed.receiverAccount}`);
    console.log(`حساب المرسل:   ${parsed.senderAccount}`);
    console.log(`التاريخ:       ${parsed.transactionDate || 'غير صالح / غير مستخرج'} (يحتاج مراجعة: ${parsed.dateNeedsReview})`);
    console.log(`الوقت:         ${parsed.transactionTime}`);
  }

  await worker.terminate();
}

testAllFourImages().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
