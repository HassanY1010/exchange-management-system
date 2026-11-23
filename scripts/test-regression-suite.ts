import fs from 'fs';
import path from 'path';
import {
  parseBankakReceiptText,
  mergeParsedResults,
  isValidDate,
  stripUnicodeBidi,
  normalizeDigits,
} from '../lib/ocr/bankak-parser';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr';

async function runFullRegression() {
  console.log('========================================================================');
  console.log('  Comprehensive Bankak OCR & Parser Regression Test Suite');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string, actual?: any) {
    total++;
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc} (Actual: ${JSON.stringify(actual)})`);
      process.exitCode = 1;
    }
  }

  // 1. Arabic Beneficiary
  const t1 = `
رقم العملية 20038176728
إسم المرسل اليه ابوالقاسم عثمان يحى ادم
المبلغ 5,000,000.00
من حساب 1039202520143
إلى حساب 1981907490273
التاريخ 16-Nov-2026 00:02:31
  `;
  const p1 = parseBankakReceiptText(t1);
  assert(p1.receiverName === 'ابوالقاسم عثمان يحى ادم', '1. Arabic beneficiary extracted accurately', p1.receiverName);

  // 2. Beneficiary labeled as "إسم المرسل" due to OCR line wrap (Must be treated as Beneficiary, NOT sender)
  const t2 = `
رقم العملية 20307388216
من حساب 0063 0260 6903 0001
الى حساب 1083 0288 5427 0001
إسم المرسل عمار ابراهيم عبد الله
المبلغ 5,000,000.00
التاريخ 17-Nov-2026 18:39:36
  `;
  const p2 = parseBankakReceiptText(t2);
  assert(p2.receiverName === 'عمار ابراهيم عبد الله', '2. Name following accounts extracted as Beneficiary', p2.receiverName);
  assert(p2.senderName === '', '2. Sender name left empty for Bankak transfers', p2.senderName);

  // 3. Amount in millions
  const t3 = `المبلغ 5,000,000.00 SDG`;
  const p3 = parseBankakReceiptText(t3);
  assert(p3.amount === 5000000 && p3.amountValid === true, '3. Amount in millions parsed correctly', p3.amount);

  // 4. Bank account preserving leading zeros
  const t4 = `من حساب 0001 6632 0869 1003\nالى حساب 0001 2932 0506 1363`;
  const p4 = parseBankakReceiptText(t4);
  assert(p4.senderAccount === '0001663208691003', '4a. Sender account preserves leading zeros', p4.senderAccount);
  assert(p4.receiverAccount === '0001293205061363', '4b. Receiver account preserves leading zeros', p4.receiverAccount);

  // 5. Valid Gregorian Dates (Arabic and English month formats)
  const t5_eng = `التاريخ و الزمن 15-Nov-2026 13:15:54`;
  const p5_eng = parseBankakReceiptText(t5_eng);
  assert(p5_eng.transactionDate === '2026-11-15' && p5_eng.dateValid === true, '5a. English named month date parsed', p5_eng.transactionDate);

  const t5_ara = `التاريخ 20 نوفمبر 2026`;
  const p5_ara = parseBankakReceiptText(t5_ara);
  assert(p5_ara.transactionDate === '2026-11-20' && p5_ara.dateValid === true, '5b. Arabic month date parsed', p5_ara.transactionDate);

  // 6. Invalid / Impossible date (e.g. 47-Nov-2026) MUST NOT be accepted, converted, or defaulted
  const t6 = `التاريخ و الزمن 19:28:45 47-Nov-2026`;
  const p6 = parseBankakReceiptText(t6);
  assert(p6.dateValid === false, '6a. Invalid date (47-Nov-2026) rejected (dateValid = false)', p6.dateValid);
  assert(p6.transactionDate === '', '6b. Invalid date does NOT produce today or fake date', p6.transactionDate);

  // 7. Transaction ID extraction
  const t7 = `رقم العملية 21255688390`;
  const p7 = parseBankakReceiptText(t7);
  assert(p7.transactionId === '21255688390', '7. Transaction ID extracted strictly', p7.transactionId);

  // 8. Stripping Unicode BiDi Marks (RLM \u200F and LRM \u200E)
  const t8 = `\u200Fالمبلغ \u200E5,000,000.00\u200F`;
  const p8 = parseBankakReceiptText(t8);
  assert(p8.amount === 5000000, '8. Strips invisible BiDi directional marks cleanly', p8.amount);

  // 9. OCR text with NO beneficiary
  const t9 = `
رقم العملية 20038176728
المبلغ 5,000,000.00
من حساب 1039202520143
الى حساب 1981907490273
التاريخ 16-Nov-2026 00:02:31
  `;
  const p9 = parseBankakReceiptText(t9);
  assert(p9.receiverName === '', '9a. Missing beneficiary left empty without fake fallback', p9.receiverName);
  assert(p9.receiverNameValid === false, '9b. Missing beneficiary flagged receiverNameValid = false', p9.receiverNameValid);
  assert(p9.ocrConfidence < 100, '9c. Confidence reflects missing recipient (<= 75%)', p9.ocrConfidence);

  // 10. OCR text with NO date
  const t10 = `
رقم العملية 20038176728
إسم المرسل اليه ابوالقاسم عثمان يحى ادم
المبلغ 5,000,000.00
من حساب 1039202520143
الى حساب 1981907490273
  `;
  const p10 = parseBankakReceiptText(t10);
  assert(p10.transactionDate === '', '10a. Missing date returns empty string', p10.transactionDate);
  assert(p10.dateValid === false, '10b. Missing date flagged dateValid = false', p10.dateValid);
  assert(p10.ocrConfidence === 90, '10c. Confidence reduced by date weight (90%)', p10.ocrConfidence);

  // 11. End-to-End Real Image Recognition on all 4 Production Images
  console.log('\n--- 11. Testing Real Production Images with processReceiptImageWithOcr ---');
  const fixtures = [
    { file: 'prod_receipt_21255688390.png', txn: '21255688390', amount: 5000000, recv: 'الطيب عبد المتعال محجوب الحسن', date: '2026-11-17' },
    { file: 'prod_receipt_20307388216.png', txn: '20307388216', amount: 5000000, recv: 'عمار ابراهيم عبد الله', date: '2026-11-17' },
    { file: 'prod_receipt_20375262495.png', txn: '20375262495', amount: 1500000, recv: 'عائشه مضوى احمد ابوشمه', date: '2026-11-15' },
    { file: 'prod_receipt_20038176728.png', txn: '20038176728', amount: 5000000, recv: 'ابوالقاسم عثمان يحى ادم', date: '2026-11-16' },
  ];

  for (const item of fixtures) {
    const fPath = path.join('scripts', 'prod-fixtures', item.file);
    if (!fs.existsSync(fPath)) continue;

    const imgBuf = fs.readFileSync(fPath);
    const res = await processReceiptImageWithOcr(imgBuf);
    const p = res.parsed;

    console.log(`\nVerifying ${item.file}:`);
    console.log(`  Txn ID:       ${p.transactionId}`);
    console.log(`  Amount:       ${p.amount}`);
    console.log(`  Beneficiary:  "${p.receiverName}"`);
    console.log(`  Date:         "${p.transactionDate}"`);
    console.log(`  Confidence:   ${p.ocrConfidence}%`);

    assert(p.transactionId === item.txn, `Image ${item.file}: Txn ID matches ${item.txn}`, p.transactionId);
    assert(p.amount === item.amount, `Image ${item.file}: Amount matches ${item.amount}`, p.amount);
    assert(p.receiverName.includes(item.recv.split(' ')[0]), `Image ${item.file}: Beneficiary contains ${item.recv.split(' ')[0]}`, p.receiverName);
    assert(p.transactionDate === item.date, `Image ${item.file}: Date matches ${item.date}`, p.transactionDate);
    assert(p.ocrConfidence === 100, `Image ${item.file}: Verified OCR Confidence is 100%`, p.ocrConfidence);
  }

  console.log(`\n========================================================================`);
  console.log(`  Final Result: ${passed}/${total} assertions passed (${((passed / total) * 100).toFixed(0)}%)!`);
  console.log(`========================================================================`);
}

runFullRegression().catch(console.error);
