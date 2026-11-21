import { parseBankakReceiptText, computeImageHash } from '../lib/ocr/bankak-parser.ts';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr.ts';

async function runOcrTests() {
  console.log('--- اختبار محرك فحص إيصالات بنكك والتعرف الضوئي (OCR) ---');

  // Test 1: Standard Arabic Bankak Receipt Text
  const sampleText1 = `
    بنك الخرطوم - Bank of Khartoum
    إشعار تحويل مالي ناجح
    رقم العملية: 241121008892
    المبلغ: 2,000,000.00 ج.س
    المرسل: أحمد محمد علي
    من حساب: 1234567
    المستلم: صرافة الأمانة والتحويلات
    إلى حساب: 7654321
    التاريخ: 2026-11-21
    الوقت: 11:45:30
    الحالة: ناجحة
  `;

  const parsed1 = parseBankakReceiptText(sampleText1);
  console.log('\n[اختبار 1] فحص إيصال بنكك عربي قياسي:');
  console.log(`- رقم العملية المستخرج: ${parsed1.transactionId}`);
  console.log(`- المبلغ المستخرج: ${parsed1.amount} SDG`);
  console.log(`- المرسل: ${parsed1.senderName} (${parsed1.senderAccount})`);
  console.log(`- المستلم: ${parsed1.receiverName} (${parsed1.receiverAccount})`);
  console.log(`- التاريخ والوقت: ${parsed1.transactionDate} ${parsed1.transactionTime}`);
  console.log(`- نسبة الثقة: ${parsed1.ocrConfidence}%`);

  if (parsed1.transactionId !== '241121008892' || parsed1.amount !== 2000000) {
    throw new Error('فشل استخراج بيانات الإيصال العربي');
  }

  // Test 2: English / Mixed Bankak Receipt Format
  const sampleText2 = `
    BOK - Bankak Transfer Notification
    Transaction Ref: TRX-55443322
    Amount: 750,000 SDG
    From: OMAR KHALID
    Account: 19827364
    To: EXCHANGE MAIN CASH
    Date: 2026-11-21
    Time: 14:20:00
    Status: Successful
  `;

  const parsed2 = parseBankakReceiptText(sampleText2);
  console.log('\n[اختبار 2] فحص إيصال بنكك إنجليزي / مختلط:');
  console.log(`- رقم العملية المستخرج: ${parsed2.transactionId}`);
  console.log(`- المبلغ المستخرج: ${parsed2.amount} SDG`);
  console.log(`- نسبة الثقة: ${parsed2.ocrConfidence}%`);

  if (parsed2.transactionId !== 'TRX-55443322' || parsed2.amount !== 750000) {
    throw new Error('فشل استخراج بيانات الإيصال الإنجليزي');
  }

  // Test 3: Image Hash and Duplicate Detection
  console.log('\n[اختبار 3] فحص تجزئة الصور (Image Hashing) وكشف التكرار:');
  const bufferA = Buffer.from('sample_receipt_image_data_A_2026');
  const bufferB = Buffer.from('sample_receipt_image_data_A_2026'); // identical
  const bufferC = Buffer.from('sample_receipt_image_data_C_different');

  const hashA = computeImageHash(bufferA);
  const hashB = computeImageHash(bufferB);
  const hashC = computeImageHash(bufferC);

  console.log(`- Hash A: ${hashA}`);
  console.log(`- Hash B: ${hashB}`);
  console.log(`- Hash C: ${hashC}`);

  if (hashA !== hashB) {
    throw new Error('فشل تطابق الهاش للصور المتطابقة');
  }
  if (hashA === hashC) {
    throw new Error('الهاش متطابق لصور مختلفة');
  }
  console.log('✅ كشف التكرار بالبصمة الرقمية SHA-256 يعمل بدقة 100%');

  // Test 4: OCR Engine processReceiptImageWithOcr
  console.log('\n[اختبار 4] فحص معالج الصور processReceiptImageWithOcr:');
  const ocrResult = await processReceiptImageWithOcr('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', sampleText1);
  console.log(`- المحرك المستخدم: ${ocrResult.engineUsed}`);
  console.log(`- بصمة الصورة: ${ocrResult.imageHash}`);
  console.log(`- رقم العملية: ${ocrResult.parsed.transactionId}`);
  console.log(`- زمن المعالجة: ${ocrResult.durationMs}ms`);

  if (ocrResult.parsed.amount !== 2000000) {
    throw new Error('فشل معالجة الإيصال عبر المحرك المتكامل');
  }

  console.log('\n🎉 جميع اختبارات OCR والتعرف على إيصالات بنكك نجحت بنسبة 100%!\n');
}

runOcrTests().catch((err) => {
  console.error('❌ خطأ في اختبارات OCR:', err);
  process.exit(1);
});
