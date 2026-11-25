import { prisma } from '../lib/db';
import { postLedgerTransaction } from '../lib/accounting/accounting-service';
import { generateCustomerStatement } from '../lib/customers/customer-statement-service';
import { buildCustomerStatementPdf } from '../lib/pdf/customer-statement-pdf';
import Decimal from 'decimal.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const suffix = Date.now().toString();
  const createdLedgerIds: string[] = [];
  let customerId = '';

  try {
    // 1. Fetch required system accounts
    const acc1030 = await prisma.account.findFirst({ where: { accountCode: '1030' } }); // Bankak SDG
    const acc2015 = await prisma.account.findFirst({ where: { accountCode: '2015' } }); // Customer Liability SDG
    const acc1065 = await prisma.account.findFirst({ where: { accountCode: '1065' } }); // Currency Clearing SDG
    const acc2010 = await prisma.account.findFirst({ where: { accountCode: '2010' } }); // Customer Liability EGP
    const acc1010 = await prisma.account.findFirst({ where: { accountCode: '1010' } }); // Safe EGP

    if (!acc1030 || !acc2015 || !acc1065 || !acc2010 || !acc1010) {
      throw new Error('Missing required chart of accounts (1030, 2015, 1065, 2010, 1010)');
    }

    // 2. Create isolated test customer & session (15,000,000 SDG at rate 216.5 or 20,000,000 SDG at rate 200)
    // Let's use the exact 20,000,000 SDG / 200 = 100,000 EGP example with 60,000 EGP partial payout
    const customer = await prisma.customer.create({
      data: {
        customerCode: `REC-${suffix.slice(-5)}`,
        name: `عميل المطابقة ${suffix.slice(-4)}`,
        phone: `+24991${suffix.slice(-7)}`,
        status: 'active',
      },
    });
    customerId = customer.id;

    const bDate = '2026-11-20';
    const session = await prisma.customerSession.create({
      data: {
        sessionNumber: `SES-REC-${suffix.slice(-5)}`,
        customerId: customer.id,
        businessDate: bDate,
        exchangeRate: 200,
        currencyFrom: 'SDG',
        currencyTo: 'EGP',
        requestedAmount: 100000,
        expectedAmount: 20000000,
        receivedAmount: 20000000,
        deliveredAmount: 60000,
        remainingAmount: 0,
        status: 'partially_delivered',
        createdBy: 'LedgerVerifier',
      },
    });

    // 3. Post 5 approved receipts & matching LedgerEntries (exact mirror of approve/route.ts)
    for (let i = 1; i <= 5; i++) {
      const rcp = await prisma.bankakReceipt.create({
        data: {
          receiptNumber: `RCP-REC-${suffix.slice(-4)}-${i}`,
          transactionId: `2135873646${i}`,
          customerId: customer.id,
          customerSessionId: session.id,
          amount: 4000000,
          currency: 'SDG',
          transactionDate: bDate,
          imageStorageKey: 'no-image',
          imageHash: `hash-rec-${suffix}-${i}`,
          status: 'approved',
          approvedBy: 'LedgerVerifier',
          approvedAt: new Date(`2026-11-20T10:0${i}:00Z`),
          createdBy: 'LedgerVerifier',
        },
      });

      const je = await prisma.$transaction(async (tx) => {
        return postLedgerTransaction({
          entryType: 'bankak_receipt',
          referenceType: 'BankakReceipt',
          referenceId: rcp.id,
          entryDate: bDate,
          description: `[TEST] استلام إشعار بنكك ${rcp.transactionId}`,
          createdBy: 'LedgerVerifier',
          tx,
          lines: [
            { accountId: acc1030.id, currency: 'SDG', debit: 4000000, credit: 0 },
            { accountId: acc2015.id, currency: 'SDG', debit: 0, credit: 4000000 },
          ],
        });
      }, { maxWait: 15000, timeout: 30000 });
      createdLedgerIds.push(je.id);
    }

    // 4. Post 60,000 EGP partial payout + matching LedgerEntries (exact mirror of deliver/route.ts)
    await prisma.cashPayoutVoucher.create({
      data: {
        voucherNumber: `VCH-REC-${suffix.slice(-5)}`,
        customerSessionId: session.id,
        customerId: customer.id,
        amount: 60000,
        currency: 'EGP',
        exchangeRate: 200,
        equivalentSdg: 12000000,
        cashSourceAccountId: acc1010.id,
        paidBy: 'LedgerVerifier',
        paidAt: new Date('2026-11-20T15:00:00Z'),
        recipientName: customer.name,
        status: 'issued',
      },
    });

    const jeClear = await prisma.$transaction(async (tx) => {
      return postLedgerTransaction({
        entryType: 'currency_exchange_sdg_clear',
        referenceType: 'CustomerSession',
        referenceId: session.id,
        entryDate: bDate,
        description: `[TEST] تسوية 12,000,000 SDG لجلسة ${session.sessionNumber}`,
        createdBy: 'LedgerVerifier',
        tx,
        lines: [
          { accountId: acc2015.id, currency: 'SDG', debit: 12000000, credit: 0 },
          { accountId: acc1065.id, currency: 'SDG', debit: 0, credit: 12000000 },
        ],
      });
    }, { maxWait: 15000, timeout: 30000 });
    createdLedgerIds.push(jeClear.id);

    const jePayout = await prisma.$transaction(async (tx) => {
      return postLedgerTransaction({
        entryType: 'customer_cash_delivery',
        referenceType: 'CustomerSession',
        referenceId: session.id,
        entryDate: bDate,
        description: `[TEST] تسليم نقدي 60,000 EGP لجلسة ${session.sessionNumber}`,
        createdBy: 'LedgerVerifier',
        tx,
        lines: [
          { accountId: acc2010.id, currency: 'EGP', debit: 60000, credit: 0 },
          { accountId: acc1010.id, currency: 'EGP', debit: 0, credit: 60000 },
        ],
      });
    }, { maxWait: 15000, timeout: 30000 });
    createdLedgerIds.push(jePayout.id);

    // 5. Query actual LedgerEntries & LedgerLines created for this test
    const entries = await prisma.ledgerEntry.findMany({
      where: { id: { in: createdLedgerIds } },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: 'asc' },
    });

    console.log('\n=== FULL LEDGER ENTRIES & LINES TRACE ===');
    for (const je of entries) {
      console.log(`Entry ${je.entryNumber} | type=${je.entryType} | ref=${je.referenceType}:${je.referenceId}`);
      for (const l of je.lines) {
        console.log(
          `   Line: Account=${l.account.accountCode} (${l.currency}) | Debit=${Number(l.debit).toLocaleString()} | Credit=${Number(l.credit).toLocaleString()}`
        );
      }
    }

    const lines = entries.flatMap((e) => e.lines);
    const accTotals: Record<string, { name: string; currency: string; debit: Decimal; credit: Decimal }> = {};
    for (const l of lines) {
      const code = l.account.accountCode;
      if (!accTotals[code]) {
        accTotals[code] = {
          name: l.account.name,
          currency: l.currency,
          debit: new Decimal(0),
          credit: new Decimal(0),
        };
      }
      accTotals[code].debit = accTotals[code].debit.plus(l.debit.toString());
      accTotals[code].credit = accTotals[code].credit.plus(l.credit.toString());
    }

    // 6. Generate Statements (EGP & SDG)
    const [stmtEgp, stmtSdg] = await Promise.all([
      generateCustomerStatement({ customerId: customer.id, currency: 'EGP' }),
      generateCustomerStatement({ customerId: customer.id, currency: 'SDG' }),
    ]);

    console.log('\n=== SDG STATEMENT ROWS ===');
    for (const r of stmtSdg!.rows) {
      console.log(`${r.date} | ${r.source} (${r.reference}) | Dr=${r.debit} | Cr=${r.credit} | Bal=${r.runningBalance}`);
    }

    console.log('\n=== EGP STATEMENT ROWS ===');
    for (const r of stmtEgp!.rows) {
      console.log(`${r.date} | ${r.source} (${r.reference}) | Dr=${r.debit} | Cr=${r.credit} | Bal=${r.runningBalance}`);
    }

    console.log('\n=== LEDGER ACCOUNTS SUMMARY (FROM REAL LedgerLine ROWS) ===');
    for (const [code, info] of Object.entries(accTotals)) {
      const net = info.credit.minus(info.debit);
      console.log(`${code} (${info.name}) [${info.currency}]: Debit=${info.debit.toFixed(2)}, Credit=${info.credit.toFixed(2)}, Net(Cr-Dr)=${net.toFixed(2)}`);
    }

    console.log('\n=== STATEMENT SUMMARY (FROM generateCustomerStatement) ===');
    console.log(`EGP Statement: Credit=${stmtEgp!.totalCredit}, Debit=${stmtEgp!.totalDebit}, Closing=${stmtEgp!.closingBalance} EGP`);
    console.log(`SDG Statement: Credit=${stmtSdg!.totalCredit}, Debit=${stmtSdg!.totalDebit}, Closing=${stmtSdg!.closingBalance} SDG`);

    // Exact same-currency same-account parity assertions
    const acc2015Cr = accTotals['2015'].credit.toNumber();
    const acc2015Dr = accTotals['2015'].debit.toNumber();
    const acc2015Net = accTotals['2015'].credit.minus(accTotals['2015'].debit).toNumber();
    const acc2010Dr = accTotals['2010'].debit.toNumber();
    console.log(`\nEXACT SDG PARITY (Statement vs 2015): CrDiff=${stmtSdg!.totalCredit - acc2015Cr}, DrDiff=${stmtSdg!.totalDebit - acc2015Dr}, NetDiff=${stmtSdg!.closingBalance - acc2015Net}`);
    console.log(`EXACT EGP PAYOUT PARITY (Statement Debit vs 2010 Debit): DrDiff=${stmtEgp!.totalDebit - acc2010Dr}`);

    // 7. Generate real PDF matching this exact scenario and save to scratch for visual inspection
    const pdfBuf = await buildCustomerStatementPdf(
      stmtEgp!,
      { name: 'أبو جواد للتجارة', phone: '+20 100 000 0000' },
      'المحاسب المالي'
    );
    const scratchDir = 'C:/Users/HP/.gemini/antigravity/brain/a3336cd6-8309-4c47-b12b-83c78d3c2851/scratch';
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(path.join(scratchDir, 'reconciled-statement-egp.pdf'), pdfBuf);
    console.log(`Saved visual verification PDF: ${path.join(scratchDir, 'reconciled-statement-egp.pdf')} (${pdfBuf.length} bytes)`);
  } finally {
    // Rollback/reverse account balance impacts & delete all temporary test records
    if (createdLedgerIds.length > 0) {
      const linesToRevert = await prisma.ledgerLine.findMany({
        where: { ledgerEntryId: { in: createdLedgerIds } },
        include: { account: true },
      });
      for (const line of linesToRevert) {
        const isAssetOrExpense = ['cash_safe', 'bank', 'bankak', 'employee_custody', 'expense', 'clearing'].includes(
          line.account.accountType
        );
        const dDebit = new Decimal(line.debit.toString());
        const dCredit = new Decimal(line.credit.toString());
        // Reverse delta
        const delta = isAssetOrExpense ? dCredit.minus(dDebit) : dDebit.minus(dCredit);
        await prisma.account.update({
          where: { id: line.accountId },
          data: { currentBalance: { increment: delta.toNumber() } },
        });
      }
      await prisma.ledgerLine.deleteMany({ where: { ledgerEntryId: { in: createdLedgerIds } } });
      await prisma.ledgerEntry.deleteMany({ where: { id: { in: createdLedgerIds } } });
    }
    if (customerId) {
      await prisma.cashPayoutVoucher.deleteMany({ where: { customerId } });
      await prisma.bankakReceipt.deleteMany({ where: { customerId } });
      await prisma.customerSession.deleteMany({ where: { customerId } });
      await prisma.customer.delete({ where: { id: customerId } });
    }
    await prisma.$disconnect();
    console.log('Cleanup complete (all test LedgerEntries, balances, and records reverted).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
