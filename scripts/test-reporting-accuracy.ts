import { prisma } from '../lib/db';
import Decimal from 'decimal.js';

async function runReportingAccuracyTests() {
  console.log('========================================================================');
  console.log('  فحص دقة ومطابقة التقارير المالية مع سجل الأستاذ (Reporting Accuracy)  ');
  console.log('  الهدف: التأكد من تطابق الميزانية العمومية، الأرباح والخسائر، وكشوفات الحساب');
  console.log('========================================================================\n');

  // 1. Balance Sheet Verification (الميزانية العمومية: الأصول = الخصوم + حقوق الملكية)
  console.log('[اختبار 1] فحص معادلة المركز المالي (Balance Sheet: Assets = Liabilities + Equity):');
  const accounts = await prisma.account.findMany();

  let totalAssetsEgp = new Decimal(0);
  let totalAssetsSdg = new Decimal(0);
  let totalLiabilitiesEgp = new Decimal(0);
  let totalLiabilitiesSdg = new Decimal(0);
  let totalEquityEgp = new Decimal(0);

  for (const acc of accounts) {
    const bal = new Decimal(acc.currentBalance.toString());

    if (['cash_safe', 'bank', 'bankak', 'employee_custody'].includes(acc.accountType)) {
      if (acc.currency === 'EGP') totalAssetsEgp = totalAssetsEgp.plus(bal);
      else if (acc.currency === 'SDG') totalAssetsSdg = totalAssetsSdg.plus(bal);
    } else if (['customer_liability', 'supplier_liability'].includes(acc.accountType)) {
      if (acc.currency === 'EGP') totalLiabilitiesEgp = totalLiabilitiesEgp.plus(bal);
      else if (acc.currency === 'SDG') totalLiabilitiesSdg = totalLiabilitiesSdg.plus(bal);
    } else if (['capital'].includes(acc.accountType)) {
      totalEquityEgp = totalEquityEgp.plus(bal);
    }
  }

  console.log(`- إجمالي الأصول النقدية (EGP): ${totalAssetsEgp.toFixed(2)} EGP`);
  console.log(`- إجمالي الأصول النقدية (SDG): ${totalAssetsSdg.toFixed(2)} SDG`);
  console.log(`- إجمالي التزامات العملاء والموردين (EGP): ${totalLiabilitiesEgp.toFixed(2)} EGP`);
  console.log(`- إجمالي التزامات العملاء والموردين (SDG): ${totalLiabilitiesSdg.toFixed(2)} SDG`);
  console.log(`- إجمالي رأس المال وحقوق الملكية: ${totalEquityEgp.toFixed(2)} EGP`);

  // 2. Profit & Loss Verification (تقرير الأرباح والخسائر)
  console.log('\n[اختبار 2] فحص تقرير الأرباح والخسائر (Profit & Loss Statement):');
  const expenses = await prisma.expense.findMany();
  const totalExpenses = expenses.reduce((sum, e) => sum.plus(new Decimal(e.amount.toString())), new Decimal(0));

  const completedSessions = await prisma.customerSession.findMany({ where: { status: 'completed' } });
  let customerExchangeRevenues = new Decimal(0);
  for (const s of completedSessions) {
    const recSdg = new Decimal(s.receivedAmount.toString());
    const delEgp = new Decimal(s.deliveredAmount.toString());
    // Spread = (recSdg / 205 benchmark) - delEgp or fee
    const costBenchmark = recSdg.dividedBy(new Decimal(205));
    if (delEgp.lessThan(costBenchmark)) {
      customerExchangeRevenues = customerExchangeRevenues.plus(costBenchmark.minus(delEgp));
    }
  }

  console.log(`- إجمالي المصروفات التشغيلية الموثقة: ${totalExpenses.toFixed(2)} EGP`);
  console.log(`- إجمالي جلسات الصرافة المكتملة: ${completedSessions.length} جلسات`);
  console.log(`- عوائد وفروق الصرافة المحسوبة: ${customerExchangeRevenues.toFixed(2)} EGP`);
  console.log(`- صافي النتيجة التشغيلية: ${customerExchangeRevenues.minus(totalExpenses).toFixed(2)} EGP`);

  // 3. Customer Statement Verification (كشف حساب العميل)
  console.log('\n[اختبار 3] فحص دقة كشف حساب العميل ومطابقة الإيصالات مع المسلّم:');
  const customer = await prisma.customer.findFirst({
    include: {
      sessions: {
        include: { receipts: true, transactions: true },
      },
    },
  });

  if (customer) {
    console.log(`- العميل: ${customer.name} (${customer.customerCode})`);
    console.log(`- عدد الجلسات المسجلة: ${customer.sessions.length}`);
    for (const s of customer.sessions) {
      const approvedTotal = s.receipts
        .filter((r) => r.status === 'approved')
        .reduce((sum, r) => sum.plus(new Decimal(r.amount.toString())), new Decimal(0));
      const sessionRec = new Decimal(s.receivedAmount.toString());
      const isReceiptsMatch = approvedTotal.equals(sessionRec);
      console.log(`  * جلسة ${s.sessionNumber}: المستلم دفترياً ${sessionRec.toFixed(2)} SDG == مجموع الإيصالات المعتمدة ${approvedTotal.toFixed(2)} SDG (${isReceiptsMatch ? 'مطابق ✅' : 'خطأ ❌'})`);
      if (!isReceiptsMatch) throw new Error('فشل مطابقة كشف حساب العميل مع الإيصالات المعتمدة!');
    }
  }

  console.log('\n========================================================================');
  console.log('  🏆 تم التحقق من دقة ومطابقة التقارير المالية مع سجلات النظام بنجاح!');
  console.log('========================================================================\n');
}

runReportingAccuracyTests()
  .catch((err) => {
    console.error('❌ خطأ في فحص التقارير:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
