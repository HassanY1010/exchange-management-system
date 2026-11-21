import { PrismaClient } from '@prisma/client';

async function main() {
  const originalPrisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://postgres:postgres@localhost:5432/exchange_platform_db?schema=public' } }
  });

  const restoredPrisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://postgres:postgres@localhost:5432/exchange_restore_test?schema=public' } }
  });

  try {
    console.log('========================================================================');
    console.log('  مقارنة وتحقق دقة استعادة قاعدة البيانات (Backup & Restore Verification) ');
    console.log('========================================================================\n');

    const tables = [
      'Account', 'Customer', 'CustomerSession', 'BankakReceipt', 'CashPayoutVoucher',
      'BankStatement', 'BankStatementLine', 'LedgerEntry', 'LedgerLine', 'AuditLog',
      'DailyClosing', 'Employee', 'EmployeeCustody', 'Supplier', 'Debt', 'Expense'
    ];

    let allMatched = true;

    for (const table of tables) {
      const origCount: any = await originalPrisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${table}"`);
      const restCount: any = await restoredPrisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${table}"`);

      const c1 = origCount[0].count;
      const c2 = restCount[0].count;
      const match = c1 === c2;
      if (!match) allMatched = false;

      console.log(`- الجدول [${table.padEnd(20)}]: الأصلي = ${c1.toString().padStart(4)} | المستعاد = ${c2.toString().padStart(4)} | ${match ? '✅ مطابق تماماً' : '❌ اختلاف!'}`);
    }

    // Compare Account balances
    const origAccounts = await originalPrisma.account.findMany({ orderBy: { accountCode: 'asc' } });
    const restAccounts = await restoredPrisma.account.findMany({ orderBy: { accountCode: 'asc' } });

    console.log('\nمقارنة أرصدة الحسابات المالية بين الأصلي والمستعاد:');
    let balancesMatched = true;
    for (let i = 0; i < origAccounts.length; i++) {
      const a1 = origAccounts[i];
      const a2 = restAccounts[i];
      const b1 = Number(a1.currentBalance).toFixed(2);
      const b2 = Number(a2.currentBalance).toFixed(2);
      const m = b1 === b2 && a1.accountCode === a2.accountCode;
      if (!m) balancesMatched = false;
      console.log(`  حساب ${a1.accountCode} (${a1.name}): أصلي = ${b1} ${a1.currency} | مستعاد = ${b2} ${a2.currency} -> ${m ? '✅' : '❌'}`);
    }

    // Compare sum of ledger debit/credit
    const origLedger: any = await originalPrisma.$queryRawUnsafe(`SELECT SUM("debit") as deb, SUM("credit") as cred FROM "LedgerLine"`);
    const restLedger: any = await restoredPrisma.$queryRawUnsafe(`SELECT SUM("debit") as deb, SUM("credit") as cred FROM "LedgerLine"`);

    const debOrig = Number(origLedger[0].deb).toFixed(2);
    const debRest = Number(restLedger[0].deb).toFixed(2);
    const credOrig = Number(origLedger[0].cred).toFixed(2);
    const credRest = Number(restLedger[0].cred).toFixed(2);

    console.log(`\nمقارنة قيود الأستاذ العام:`);
    console.log(`- الأصلي: مدين = ${debOrig} | دائن = ${credOrig}`);
    console.log(`- المستعاد: مدين = ${debRest} | دائن = ${credRest}`);

    const ledgerMatched = debOrig === debRest && credOrig === credRest && debOrig === credOrig;

    if (allMatched && balancesMatched && ledgerMatched) {
      console.log('\n🎉 تم إثبات دقة الاستعادة Restore بنسبة 100% وبلا أي فقد في البيانات أو الأرصدة!');
    } else {
      console.error('\n❌ يوجد اختلاف بين البيانات الأصلية والمستعادة!', { allMatched, balancesMatched, ledgerMatched });
      process.exit(1);
    }
  } finally {
    await originalPrisma.$disconnect();
    await restoredPrisma.$disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
