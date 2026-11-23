import fs from 'fs';
import path from 'path';
import { parseBankakReceiptText } from '../lib/ocr/bankak-parser';

async function testUpdatedParser() {
  const tests = [
    {
      name: 'receipt1.jpg (Cropped bottom buttons)',
      raw: `تحويلات
a
=
إضافة مستفيد تحويل bye اخرى
224 بنك الخرطوم | بنكك حساب`,
    },
    {
      name: 'receipt2.jpg (Account to account, amount cropped)',
      raw: `تحويلات
رقم العملية 20038176728
التاريخ و الزمن 00:02:31 16-Nov-2026
من حساب 1 0392 0252 0143
الى حساب 1 9819 0749 0273
رقم الموبايل N/A
ست
2
Ca)
إضافة مستفيد تحويل مرة اخرى
سه لهس 6س
24 بنك الخرطوم | بنكك حساب`,
    },
    {
      name: 'receipt3.jpg (1,000,000 SDG transfer)',
      raw: `تحويلات
رقم العملية 20188179228
التاريخ و الزمن 00:06:50 16-Nov-2026
من حساب 0001 0392 0252 0143
الى حساب 0001 9819 0749 0273
رقم الموبايل N/A
التعليق N/A
المبلغ 1,000,000.00
ات
0
a
إضافة مستفيد تحويل مرة اخرى
5 مشاركة | = طباعة ® تحميل
4 ينك الخرطيم | بتك اك`,
    },
    {
      name: 'receipt4.jpg (1,800,000 SDG transfer)',
      raw: `تحويلات
رقم العملية 20026330498
التاريخ و الزمن 15:00:23 15-Nov-2026
من حساب 0001 9436 0645 1363
الى حساب 0001 9331 0007 1363
رقم الموبايل N/A
التعليق N/A
المبلغ 1,800,000.00
a
<
Ca)
إضافة مستفيد تحويل مرة اخرى
5 مشاركة | = طباعة ® تحميل
4 ينك الخرطوم | بتكك حساب`,
    },
    {
      name: 'receipt_with_explicit_recipient (Explicit name)',
      raw: `تحويلات
رقم العملية 21255688390
التاريخ و الزمن 19:28:45 23-Nov-2026
اسم المرسل: محمد أحمد عثمان
من حساب 0001 5427 0288 1083
اسم المستفيد: شركة الأمل للصرافة
الى حساب 0001 1234 5678 9012
المبلغ 5,000,000.00 SDG`,
    },
  ];

  for (const t of tests) {
    console.log(`\n========================================`);
    console.log(`Testing: ${t.name}`);
    console.log(`========================================`);
    const p = parseBankakReceiptText(t.raw);
    console.log(`- Transaction ID: '${p.transactionId}'`);
    console.log(`- Amount: ${p.amount} SDG (amountNeedsReview: ${p.amountNeedsReview})`);
    console.log(`- Date: '${p.transactionDate}' | Time: '${p.transactionTime}'`);
    console.log(`- Sender Name: '${p.senderName}' | Sender Account: '${p.senderAccount}'`);
    console.log(`- Receiver Name: '${p.receiverName}' | Receiver Account: '${p.receiverAccount}'`);
    console.log(`- OCR Confidence: ${p.ocrConfidence}%`);
  }
}

testUpdatedParser();
