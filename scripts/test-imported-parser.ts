import { parseBankakReceiptText } from '../lib/ocr/bankak-parser';

const testSample = `
إشعار التحويل المالي
إسم المرسل اليه ابوالقاسم عثمان يحى ادم
المبلغ 5,000,000.00
من حساب 1039202520143
إلى حساب 1981907490273
رقم المرجع 20038176728
التاريخ 16-Nov-2026 00:02:31
`;

const res = parseBankakReceiptText(testSample);
console.log('Direct Imported Parser Verification:');
console.log('Transaction ID:', res.transactionId);
console.log('Beneficiary:', res.receiverName);
console.log('Amount:', res.amount);
console.log('Date:', res.transactionDate);
console.log('Time:', res.transactionTime);
console.log('Confidence:', res.ocrConfidence);

if (
  res.transactionId === '20038176728' &&
  res.receiverName === 'ابوالقاسم عثمان يحى ادم' &&
  res.amount === 5000000 &&
  res.transactionDate === '2026-11-16' &&
  res.ocrConfidence === 100
) {
  console.log('ALL ASSERTIONS PASSED 100%!');
} else {
  console.error('FAILED ASSERTIONS');
  process.exit(1);
}
