import assert from 'assert';
import {
  calculateExchange,
  calculateSessionBalance,
  validateDoubleEntry,
  calculateCustodyBalance,
  calculateWeightedAverageCost,
  reconcileDailyClosing,
} from '../lib/financial-core/index.ts';
import { parseBankakReceiptText, computeImageHash } from '../lib/ocr/bankak-parser.ts';

console.log('🧪 بدء تشغيل اختبارات المحرك المالي والحسابي ومحلل إيصالات بنكك...');

// 1. Test Exchange Calculator (PDF Page 2 & 10)
{
  const result = calculateExchange(100000, 200, 'EGP_TO_SDG');
  assert.strictEqual(result.fromAmount, 100000);
  assert.strictEqual(result.toAmount, 20000000);
  assert.strictEqual(result.rate, 200);
  console.log('  ✓ اختبار 1: حساب سعر الصرف (100,000 EGP * 200 = 20,000,000 SDG) نجح!');
}

// 2. Test Customer Daily Session Balance (PDF Page 2, 8, 14)
{
  const session1 = calculateSessionBalance({
    requestedEgpAmount: 100000,
    exchangeRate: 200,
    approvedReceiptsTotalSdg: 18000000, // 4 receipts, only 18M arrived yet
    deliveredEgpAmount: 90000,
  });
  assert.strictEqual(session1.expectedSdgAmount, 20000000);
  assert.strictEqual(session1.remainingSdgAmount, 2000000);
  assert.strictEqual(session1.remainingEgpToDeliver, 10000);
  assert.strictEqual(session1.isCompleted, false);

  // Full amount completed
  const session2 = calculateSessionBalance({
    requestedEgpAmount: 100000,
    exchangeRate: 200,
    approvedReceiptsTotalSdg: 20000000,
    deliveredEgpAmount: 100000,
  });
  assert.strictEqual(session2.remainingSdgAmount, 0);
  assert.strictEqual(session2.remainingEgpToDeliver, 0);
  assert.strictEqual(session2.isCompleted, true);
  assert.strictEqual(session2.status, 'completed');
  console.log('  ✓ اختبار 2: مطابقة الحساب اليومي للعميل والإيصالات المجزأة نجح!');
}

// 3. Test Double-Entry Accounting Rule (Total Debit = Total Credit, PDF Page 54)
{
  const validEntry = [
    { accountId: 'acc-bankak', currency: 'SDG', debit: 20000000, credit: 0 },
    { accountId: 'acc-cust-liability', currency: 'SDG', debit: 0, credit: 20000000 },
  ];
  const validCheck = validateDoubleEntry(validEntry);
  assert.strictEqual(validCheck.isValid, true);
  assert.strictEqual(validCheck.totalDebit, 20000000);
  assert.strictEqual(validCheck.totalCredit, 20000000);

  const invalidEntry = [
    { accountId: 'acc-bankak', currency: 'SDG', debit: 20000000, credit: 0 },
    { accountId: 'acc-cust-liability', currency: 'SDG', debit: 0, credit: 19000000 },
  ];
  const invalidCheck = validateDoubleEntry(invalidEntry);
  assert.strictEqual(invalidCheck.isValid, false);
  console.log('  ✓ اختبار 3: قاعدة توازن القيد المحاسبي المزدوج (Total Debit = Total Credit) نجح!');
}

// 4. Test Employee Custody Calculation (PDF Page 20 & 21)
{
  const custody = calculateCustodyBalance({
    openingAmount: 500000,
    refills: 0,
    deliveriesToCustomers: 350000, // 100,000 + 200,000 + 50,000
    expensesPaid: 0,
    returnsToSafe: 0,
  });
  assert.strictEqual(custody.openingAmount, 500000);
  assert.strictEqual(custody.totalDisbursed, 350000);
  assert.strictEqual(custody.currentRemainingBalance, 150000);
  assert.strictEqual(custody.hasSufficientBalance(150000), true);
  assert.strictEqual(custody.hasSufficientBalance(150001), false);
  console.log('  ✓ اختبار 4: حساب رصيد عهدة الموظف (500,000 - 350,000 = 150,000 EGP) نجح!');
}

// 5. Test Weighted Average Cost for Currency Inventory (PDF Page 25 & 26)
{
  const batches = [
    { amountSdg: 10000000, costEgp: 50000 },
    { amountSdg: 10000000, costEgp: 52000 },
  ];
  const costSummary = calculateWeightedAverageCost(batches);
  assert.strictEqual(costSummary.totalInventorySdg, 20000000);
  assert.strictEqual(costSummary.totalCostEgp, 102000);
  // Average rate: 20,000,000 / 102,000 = 196.0784 SDG/EGP (or 204 SDG per EGP if inverted)
  // Selling 10,000,000 SDG for 50,000 EGP:
  const sale = costSummary.calculateSaleProfit(10000000, 50000);
  assert.strictEqual(sale.cogsEgp, 51000); // 10M * (102k / 20M) = 51k
  assert.strictEqual(sale.grossProfitEgp, -1000); // 50,000 - 51,000 = -1,000 (Loss)
  assert.strictEqual(sale.isProfit, false);
  console.log('  ✓ اختبار 5: حساب متوسط تكلفة العملة المرجح والربح/الخسارة (PDF ص 25-26) نجح!');
}

// 6. Test Daily Closing & Reconciliation (PDF Page 31)
{
  const closingResult = reconcileDailyClosing('2026-11-21', [
    {
      accountId: 'acc-egp',
      accountName: 'الصندوق المصري',
      currency: 'EGP',
      openingBalance: 1000000,
      totalInflow: 0,
      totalOutflow: 100000,
      expectedBalance: 900000,
      actualCountedBalance: 899000, // 1000 deficit
    },
    {
      accountId: 'acc-sdg',
      accountName: 'صندوق بنكك',
      currency: 'SDG',
      openingBalance: 0,
      totalInflow: 20000000,
      totalOutflow: 0,
      expectedBalance: 20000000,
      actualCountedBalance: 20000000, // exact
    },
  ]);
  assert.strictEqual(closingResult.totalDiffEgp, -1000);
  assert.strictEqual(closingResult.totalDiffSdg, 0);
  assert.strictEqual(closingResult.hasVariances, true);
  console.log('  ✓ اختبار 6: مطابقة الإغلاق اليومي واكتشاف الفروقات بدقة نجح!');
}

// 7. Test Bankak OCR Text Parser (PDF Page 16)
{
  const rawOcrSample = `
    Bank of Khartoum - بنك الخرطوم
    إشعار تحويل بنكك الإلكتروني
    Transaction ID: 123456789
    Amount: 5,000,000 SDG
    المبلغ: 5,000,000 ج.س
    المرسل: أحمد محمد علي
    Sender Account: 2091823901
    المستفيد: شركة الصرافة
    Beneficiary Account: 9918273615
    Date: 21/11/2026
    Time: 14:35:10
  `;
  const parsed = parseBankakReceiptText(rawOcrSample);
  assert.strictEqual(parsed.transactionId, '123456789');
  assert.strictEqual(parsed.amount, 5000000);
  assert.strictEqual(parsed.currency, 'SDG');
  assert.strictEqual(parsed.senderName, 'أحمد محمد علي');
  assert.strictEqual(parsed.transactionDate, '2026-11-21');
  assert.ok(parsed.ocrConfidence >= 90);

  const hash1 = computeImageHash('sample-image-data-abc');
  const hash2 = computeImageHash('sample-image-data-abc');
  assert.strictEqual(hash1, hash2);
  console.log('  ✓ اختبار 7: محلل نصوص إيصالات بنكك الذكي والبصمة الرقمية لمنع التكرار نجح!');
}

console.log('\n🎉 جميع اختبارات المحرك المالي والـ OCR مرت بنجاح 100%!');
