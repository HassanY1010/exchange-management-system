import { prisma } from '../lib/db';
import { postLedgerTransaction } from '../lib/accounting/accounting-service';
import Decimal from 'decimal.js';

async function runLedgerIntegrityTests() {
  console.log('========================================================================');
  console.log('  فحص سلامة وتطابق سجل الأستاذ العام (Financial Ledger Integrity Audit)   ');
  console.log('  الهدف: التحقق من تطابق أرصدة الحسابات مع مجموع قيود اليومية بنسبة 100% ');
  console.log('========================================================================\n');

  // 1. Fetch all accounts and test Rollback mechanism
  console.log('[اختبار 1] فحص التراجع التلقائي عند الخطأ (Transaction Rollback):');
  const safeAccount = await prisma.account.findFirst({ where: { accountCode: '1010' } });
  const bankAccount = await prisma.account.findFirst({ where: { accountCode: '1040' } });

  if (!safeAccount || !bankAccount) throw new Error('الحسابات غير متوفرة');

  const safeBalBefore = Number(safeAccount.currentBalance);
  const bankBalBefore = Number(bankAccount.currentBalance);
  const ledgerCountBefore = await prisma.ledgerEntry.count();

  let rollbackSucceeded = false;
  try {
    await prisma.$transaction(async (tx) => {
      // Step A: Update account
      await tx.account.update({
        where: { id: safeAccount.id },
        data: { currentBalance: safeBalBefore + 1000000 },
      });
      // Step B: Intentionally throw an unhandled error midway
      throw new Error('فشل متعمد لاختبار التراجع والـ Rollback');
    });
  } catch (err: any) {
    if (err.message.includes('فشل متعمد')) {
      rollbackSucceeded = true;
    }
  }

  const safeBalAfterRollback = await prisma.account.findUnique({ where: { id: safeAccount.id } });
  const ledgerCountAfterRollback = await prisma.ledgerEntry.count();

  console.log(`- رصيد الخزينة قبل المحاولة الفاشلة: ${safeBalBefore.toLocaleString()} EGP`);
  console.log(`- رصيد الخزينة بعد التراجع Rollback: ${Number(safeBalAfterRollback?.currentBalance).toLocaleString()} EGP`);
  console.log(`- عدد القيود لم يتغير: ${ledgerCountBefore} == ${ledgerCountAfterRollback}`);

  if (!rollbackSucceeded || Number(safeBalAfterRollback?.currentBalance) !== safeBalBefore) {
    throw new Error('فشل نظام التراجع التلقائي Rollback!');
  }
  console.log('✅ تم إثبات الـ Rollback التام وعدم تلوث قاعدة البيانات عند حدوث أي خطأ.\n');

  // 2. Test Reversal Transactions (قيد العكس والتصحيح الرقابي)
  console.log('[اختبار 2] فحص القيود العكسية والتصحيحية (Reversal Transactions):');
  const testAmount = 25000;
  // Post original entry
  const origEntry = await postLedgerTransaction({
    entryType: 'fund_transfer',
    description: 'تحويل نقدي تجريبي سيتم عكسه',
    createdBy: 'المحاسب',
    lines: [
      {
        accountId: bankAccount.id,
        currency: 'EGP',
        debit: testAmount,
        credit: 0,
        description: 'إيداع بنكي تجريبي',
      },
      {
        accountId: safeAccount.id,
        currency: 'EGP',
        debit: 0,
        credit: testAmount,
        description: 'صرف من الخزينة',
      },
    ],
  });

  const safeBalAfterOrig = await prisma.account.findUnique({ where: { id: safeAccount.id } });
  console.log(`- تم ترحيل القيد الأصلي رقم ${origEntry.entryNumber} بمبلغ ${testAmount.toLocaleString()} EGP`);
  console.log(`- رصيد الخزينة بعد القيد: ${Number(safeBalAfterOrig?.currentBalance).toLocaleString()} EGP`);

  // Post reversal entry (Inverting Debit and Credit)
  const reversalEntry = await postLedgerTransaction({
    entryType: 'reversal',
    referenceType: 'LedgerEntry',
    referenceId: origEntry.id,
    description: `عكس وإلغاء القيد رقم ${origEntry.entryNumber}`,
    createdBy: 'المدير المالي',
    lines: [
      {
        accountId: safeAccount.id,
        currency: 'EGP',
        debit: testAmount,
        credit: 0,
        description: `إلغاء قيد الصرف من الخزينة`,
      },
      {
        accountId: bankAccount.id,
        currency: 'EGP',
        debit: 0,
        credit: testAmount,
        description: `إلغاء قيد الإيداع البنكي`,
      },
    ],
  });

  const safeBalAfterRev = await prisma.account.findUnique({ where: { id: safeAccount.id } });
  console.log(`- تم ترحيل قيد العكس والتسوية رقم ${reversalEntry.entryNumber}`);
  console.log(`- رصيد الخزينة بعد العكس: ${Number(safeBalAfterRev?.currentBalance).toLocaleString()} EGP`);

  if (Number(safeBalAfterRev?.currentBalance) !== safeBalBefore) {
    throw new Error(`فشل القيد العكسي: المتوقع ${safeBalBefore} ولكن الفعلي ${safeBalAfterRev?.currentBalance}`);
  }
  console.log('✅ اختبار القيود العكسية والتسوية نجح بنسبة 100% وعادت الأرصدة لوضعها الصحيح تماماً.\n');

  // 3. Full Ledger to Account Reconciliation Audit (المطابقة الشاملة لكل حسابات النظام)
  console.log('[اختبار 3] المطابقة الرياضية الكاملة بين قيود LedgerLine وأرصدة Account.currentBalance:');
  const allAccounts = await prisma.account.findMany({
    include: {
      ledgerLines: true,
    },
  });

  let totalDiscrepancies = 0;
  console.log('----------------------------------------------------------------------------------------------------');
  console.log('| رمز الحساب | اسم الحساب                          | العملة | رصيد الدفتر | رصيد القيود | الفرق المحاسبي |');
  console.log('----------------------------------------------------------------------------------------------------');

  for (const acc of allAccounts) {
    const dOpen = new Decimal(acc.openingBalance.toString());
    let netLines = new Decimal(0);

    for (const line of acc.ledgerLines) {
      const dDebit = new Decimal(line.debit.toString());
      const dCredit = new Decimal(line.credit.toString());

      if (['cash_safe', 'bank', 'bankak', 'employee_custody', 'expense'].includes(acc.accountType)) {
        netLines = netLines.plus(dDebit).minus(dCredit);
      } else {
        netLines = netLines.plus(dCredit).minus(dDebit);
      }
    }

    const calculatedBalance = dOpen.plus(netLines);
    const storedBalance = new Decimal(acc.currentBalance.toString());
    const diff = calculatedBalance.minus(storedBalance).abs();

    const isMatch = diff.lessThanOrEqualTo(0.0001);
    if (!isMatch) totalDiscrepancies++;

    const accNamePadded = (acc.name.length > 34 ? acc.name.substring(0, 31) + '...' : acc.name).padEnd(35);
    console.log(
      `| ${acc.accountCode.padEnd(10)} | ${accNamePadded} | ${acc.currency.padEnd(6)} | ${storedBalance.toFixed(2).padStart(11)} | ${calculatedBalance.toFixed(2).padStart(11)} | ${isMatch ? '0.00 (مطابق ✅)' : diff.toFixed(4) + ' ❌'} |`
    );
  }
  console.log('----------------------------------------------------------------------------------------------------');

  if (totalDiscrepancies > 0) {
    throw new Error(`اكتشاف ${totalDiscrepancies} فروقات حسابية بين رصيد الحساب ومجموع القيود!`);
  }

  console.log(`\n✅ تمت مطابقة جميع الحسابات (${allAccounts.length} حساباً) مع سجل القيود التراكمية بنسبة تطابق 100% ودون أي فارق مالي.\n`);

  console.log('========================================================================');
  console.log('  🏆 انتهت اختبارات سلامة وتطابق سجل الأستاذ العام بنجاح قاطع!');
  console.log('========================================================================\n');
}

runLedgerIntegrityTests()
  .catch((err) => {
    console.error('❌ خطأ في اختبارات سجل الأستاذ:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
