import { prisma } from '../lib/db';
import Decimal from 'decimal.js';

async function syncBalancesWithLedger() {
  console.log('Synchronizing Account.currentBalance with LedgerLines...');

  const accounts = await prisma.account.findMany({
    include: {
      ledgerLines: {
        include: { ledgerEntry: true },
      },
    },
  });

  for (const acc of accounts) {
    let sumDebit = new Decimal(0);
    let sumCredit = new Decimal(0);
    let hasOpeningLedgerEntry = false;

    for (const line of acc.ledgerLines) {
      sumDebit = sumDebit.plus(new Decimal(line.debit.toString()));
      sumCredit = sumCredit.plus(new Decimal(line.credit.toString()));
      if (line.ledgerEntry?.entryType === 'opening_balance') {
        hasOpeningLedgerEntry = true;
      }
    }

    const dOpening = new Decimal(acc.openingBalance.toString());
    const isDebitNormal = ['cash_safe', 'bank', 'bankak', 'employee_custody', 'expense', 'clearing', 'receivable'].includes(acc.accountType);
    const baseAmount = hasOpeningLedgerEntry ? new Decimal(0) : dOpening;
    const calculatedLedgerBalance = isDebitNormal
      ? baseAmount.plus(sumDebit).minus(sumCredit)
      : baseAmount.plus(sumCredit).minus(sumDebit);

    await prisma.account.update({
      where: { id: acc.id },
      data: { currentBalance: calculatedLedgerBalance.toFixed(4) },
    });

    console.log(`Synced ${acc.accountCode} (${acc.name}): balance set to ${calculatedLedgerBalance.toFixed(4)} ${acc.currency}`);
  }

  console.log('All accounts synchronized successfully.');
}

syncBalancesWithLedger()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
