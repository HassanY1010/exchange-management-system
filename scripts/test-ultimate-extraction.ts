import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';
import { stripUnicodeBidi, normalizeDigits, isValidDate } from '../lib/ocr/bankak-parser';

export function parseBankakUltimate(rawInput: string) {
  const normalized = normalizeDigits(rawInput || '');
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Transaction ID:
  // Must be 10-16 digits, NOT a date or time
  let transactionId = '';
  const txnLabeled = normalized.match(/(?:Transaction\s*(?:ID|No|Ref|Reference)|رقم\s*(?:العملية|المرجع|الإشعار|المعاملة)|الرقم\s*المرجعي|معرف\s*العملية)[\s:]*([A-Za-z0-9\-_]+)/i);
  if (txnLabeled && txnLabeled[1]) {
    const val = txnLabeled[1].replace(/[^0-9A-Za-z]/g, '');
    if (val.length >= 8 && !/^[0-9]{1,2}-[A-Za-z]{3}/.test(val)) {
      transactionId = val;
    }
  }
  if (!transactionId) {
    // Look for 10-12 digit sequence starting with 20 or 21 (Bankak standard)
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

  // 2. Accounts:
  let senderAccount = '';
  let receiverAccount = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/من\s*حساب|From\s*Account/i.test(line)) {
      const m = line.match(/(?:من\s*حساب|From\s*Account)[\s:]*([0-9\s]{6,30})/i);
      if (m) senderAccount = m[1].replace(/\s+/g, '');
      else if (i + 1 < lines.length && /^[0-9\s]{6,30}$/.test(lines[i + 1])) {
        senderAccount = lines[i + 1].replace(/\s+/g, '');
      }
    }
    if (/[إا]لى\s*(?:حساب|elles|0ك)|To\s*Account/i.test(line)) {
      const m = line.match(/(?:[إا]لى\s*(?:حساب|elles|0ك)|To\s*Account)[\s:]*([0-9\s]{6,30})/i);
      if (m) receiverAccount = m[1].replace(/\s+/g, '');
      else if (i + 1 < lines.length && /^[0-9\s]{6,30}$/.test(lines[i + 1])) {
        receiverAccount = lines[i + 1].replace(/\s+/g, '');
      }
    }
  }

  // 3. Beneficiary (Receiver Name):
  // Clean name helper
  const cleanPersonName = (raw: string): string => {
    let c = raw.trim();
    // Strip common labels and OCR artifacts (eee, ere, ofc, ooo, Jara eal, etc.)
    c = c.replace(/^(?:[إأآا]?سم\s*(?:المرسل\s*[إأآا]?لي[هة]|المرسل|المستفيد|المستلم)|المرسل\s*[إأآا]?لي[هة]|المستفيد|المستلم|[إا]لى|Jara\s*eal|eal|[eE]{2,4}|[oO]{2,4}|ofc|ere)[\s:]*/i, '');
    c = c.replace(/^[a-zA-Z\s]{1,6}\s+/i, ''); // Strip stray English letters
    c = c.split(/\s{2,}|[-|\n\r]/)[0].trim();
    // Validate that it looks like a real Arabic name (at least 2 words, no account numbers, no bank keywords)
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

  let receiverName = '';
  // Strategy A: Labeled beneficiary line (Bankak receipts label recipient as "إسم المرسل اليه" or sometimes truncated as "إسم المرسل")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:[إأآا]?سم\s*المرسل(?:\s*[إأآا]?لي[هة])?|[إأآا]?سم\s*المستفيد|المستفيد\b|المرسل\s*[إأآا]?لي[هة])/i.test(line)) {
      const c = cleanPersonName(line);
      if (c && c.split(/\s+/).length >= 2) {
        receiverName = c;
        break;
      }
      if (i + 1 < lines.length) {
        const nextC = cleanPersonName(lines[i + 1]);
        if (nextC && nextC.split(/\s+/).length >= 2) {
          receiverName = nextC;
          break;
        }
      }
    }
  }

  // Strategy B: Position-based extraction (in Bankak, beneficiary is located between "إلى حساب" and "المبلغ" / "رقم الموبايل")
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
          const candidate = cleanPersonName(lines[i]);
          // Must have at least 2 words and contains Arabic letters
          if (candidate && candidate.split(/\s+/).length >= 2 && /[\u0600-\u06FF]/.test(candidate)) {
            receiverName = candidate;
            break;
          }
        }
      }
    }
  }

  // 4. Amount:
  let amount = 0;
  let amountValid = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:المبلغ|القيمة|Amount)/i.test(line)) {
      const m = line.match(/(?:المبلغ|القيمة|Amount)[\s:]*([0-9]{1,3}(?:[,.][0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i);
      if (m && m[1]) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (val > 0) {
          amount = val;
          amountValid = true;
          break;
        }
      }
      if (i + 1 < lines.length) {
        const nextM = lines[i + 1].match(/^([0-9]{1,3}(?:[,.][0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/);
        if (nextM && nextM[1]) {
          const val = parseFloat(nextM[1].replace(/,/g, ''));
          if (val > 0) {
            amount = val;
            amountValid = true;
            break;
          }
        }
      }
    }
  }

  // 5. Date & Time:
  let transactionDate = '';
  let transactionTime = '';
  let dateValid = false;

  const timeMatch = normalized.match(/([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/);
  if (timeMatch) transactionTime = timeMatch[1];

  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4,
    'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8,
    'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
  };

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

  // Confidence calculation:
  // Transaction ID: 25%
  // Valid Amount: 25%
  // Valid Beneficiary: 25%
  // Valid Accounts: 15%
  // Valid Date: 10%
  let confidence = 0;
  if (transactionId) confidence += 25;
  if (amountValid) confidence += 25;
  if (receiverName && receiverName.length > 3) confidence += 25;
  if (senderAccount || receiverAccount) confidence += 15;
  if (dateValid) confidence += 10;

  const accountsValid = senderAccount.length >= 6 || receiverAccount.length >= 6;
  const receiverNameValid = Boolean(receiverName && receiverName.length > 3);
  const financialStatus = Boolean(transactionId && amountValid && receiverNameValid) ? 'pending_verification' : 'pending_review';

  return {
    transactionId,
    amount,
    amountValid,
    receiverName,
    receiverNameValid,
    senderAccount,
    receiverAccount,
    accountsValid,
    transactionDate,
    transactionTime: transactionTime || '12:00:00',
    dateValid,
    ocrConfidence: confidence,
    financialStatus,
  };
}

async function testAll() {
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

  const files = [
    'prod_receipt_21255688390.png',
    'prod_receipt_20307388216.png',
    'prod_receipt_20375262495.png',
    'prod_receipt_20038176728.png',
  ];

  for (const f of files) {
    const imgBuf = fs.readFileSync(path.join('scripts', 'prod-fixtures', f));
    // Test on PSM 4
    await worker.setParameters({ tessedit_pageseg_mode: '4' as any });
    const res4 = await worker.recognize(imgBuf);
    const p4 = parseBankakUltimate(res4.data.text);

    // If date or receiverName is missing, run PSM 11
    let finalParsed = p4;
    if (!p4.receiverName || !p4.dateValid) {
      await worker.setParameters({ tessedit_pageseg_mode: '11' as any });
      const res11 = await worker.recognize(imgBuf);
      const p11 = parseBankakUltimate(res11.data.text);

      // Merge best fields
      finalParsed = {
        transactionId: p4.transactionId || p11.transactionId,
        amount: p4.amountValid ? p4.amount : p11.amount,
        amountValid: p4.amountValid || p11.amountValid,
        receiverName: p4.receiverName || p11.receiverName,
        receiverNameValid: p4.receiverNameValid || p11.receiverNameValid,
        senderAccount: p4.senderAccount || p11.senderAccount,
        receiverAccount: p4.receiverAccount || p11.receiverAccount,
        accountsValid: p4.accountsValid || p11.accountsValid,
        transactionDate: p4.dateValid ? p4.transactionDate : p11.transactionDate,
        transactionTime: p4.transactionTime || p11.transactionTime,
        dateValid: p4.dateValid || p11.dateValid,
        ocrConfidence: 0,
        financialStatus: 'pending_review',
      };
      let conf = 0;
      if (finalParsed.transactionId) conf += 25;
      if (finalParsed.amountValid) conf += 25;
      if (finalParsed.receiverNameValid) conf += 25;
      if (finalParsed.accountsValid) conf += 15;
      if (finalParsed.dateValid) conf += 10;
      finalParsed.ocrConfidence = conf;
      finalParsed.financialStatus = Boolean(finalParsed.transactionId && finalParsed.amountValid && finalParsed.receiverNameValid)
        ? 'pending_verification'
        : 'pending_review';
    }

    console.log(`\n========================================================`);
    console.log(`File: ${f}`);
    console.log(`  Txn ID:       ${finalParsed.transactionId}`);
    console.log(`  Amount:       ${finalParsed.amount} SDG (valid: ${finalParsed.amountValid})`);
    console.log(`  Beneficiary:  "${finalParsed.receiverName}" (valid: ${finalParsed.receiverNameValid})`);
    console.log(`  Date:         "${finalParsed.transactionDate}" (valid: ${finalParsed.dateValid})`);
    console.log(`  From Acc:     "${finalParsed.senderAccount}"`);
    console.log(`  To Acc:       "${finalParsed.receiverAccount}"`);
    console.log(`  Confidence:   ${finalParsed.ocrConfidence}%`);
    console.log(`  Status:       ${finalParsed.financialStatus}`);
  }

  await worker.terminate();
}

testAll().catch(console.error);
