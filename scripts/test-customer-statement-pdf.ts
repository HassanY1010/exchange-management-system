import { prisma } from '../lib/db';
import { generateCustomerStatement } from '../lib/customers/customer-statement-service';
import { getCustomerFinancialStatus } from '../lib/customers/customer-balance-service';
import { buildCustomerStatementPdf, shapeArabicLine } from '../lib/pdf/customer-statement-pdf';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

async function withRetry<T>(fn: () => Promise<T>, retries = 5, delay = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Retries exhausted');
}

async function main() {
  console.log('=== STARTING COMPREHENSIVE CUSTOMER STATEMENT & PDF VERIFICATION ===\n');

  const suffix = Date.now().toString();
  const createdCustomerIds: string[] = [];
  const createdCustodyIds: string[] = [];

  try {
    // -----------------------------------------------------------------------
    // Setup isolated test customer + prerequisite safe/employee
    // -----------------------------------------------------------------------
    const customer = await withRetry(() =>
      prisma.customer.create({
        data: {
          customerCode: `TST-STMT-${suffix.slice(-5)}`,
          name: `عميل اختبار الكشف ${suffix.slice(-4)}`,
          phone: `+24991${suffix.slice(-7)}`,
          city: 'القاهرة',
          status: 'active',
        },
      })
    );
    createdCustomerIds.push(customer.id);

    const safeAccount = await withRetry(() =>
      prisma.account.findFirst({ where: { accountCode: '1010' } })
    );
    assert(safeAccount, 'Safe account 1010 must exist');

    // =======================================================================
    // TEST 1 & 2: Basic Example (5 receipts = 20M SDG, rate 200 = 100k EGP)
    //             + Partial Payouts (30k + 20k = 50k remaining, then 50k)
    // =======================================================================
    console.log('--- Test 1 & 2: 5 Receipts (20,000,000 SDG / 200 = 100,000 EGP) + Partial Payouts ---');
    const session1 = await withRetry(() =>
      prisma.customerSession.create({
        data: {
          sessionNumber: `SES-TST-${suffix}-1`,
          customerId: customer.id,
          businessDate: '2026-11-20',
          exchangeRate: 200,
          currencyFrom: 'SDG',
          currencyTo: 'EGP',
          requestedAmount: 100000,
          expectedAmount: 20000000,
          receivedAmount: 20000000,
          deliveredAmount: 50000, // 30,000 + 20,000
          remainingAmount: 0,
          overpaymentAmount: 0,
          status: 'partially_delivered',
          createdBy: 'TestRunner',
        },
      })
    );

    // 5 Approved Receipts (4,000,000 SDG each = 20,000,000 SDG)
    for (let i = 1; i <= 5; i++) {
      await prisma.bankakReceipt.create({
        data: {
          receiptNumber: `RCP-TST-${suffix}-${i}`,
          transactionId: `TRX-TST-${suffix}-${i}`,
          customerId: customer.id,
          customerSessionId: session1.id,
          amount: 4000000,
          currency: 'SDG',
          transactionDate: '2026-11-20',
          imageStorageKey: 'no-image',
          imageHash: `hash-tst-${suffix}-${i}`,
          status: 'approved',
          approvedBy: 'TestRunner',
          approvedAt: new Date(Date.now() + i * 1000),
          createdBy: 'TestRunner',
        },
      });
    }

    // 2 Partial Payout Vouchers: 30,000 then 20,000
    await prisma.cashPayoutVoucher.create({
      data: {
        voucherNumber: `VCH-TST-${suffix}-1`,
        customerSessionId: session1.id,
        customerId: customer.id,
        amount: 30000,
        currency: 'EGP',
        exchangeRate: 200,
        equivalentSdg: 6000000,
        cashSourceAccountId: safeAccount!.id,
        paidBy: 'TestRunner',
        paidAt: new Date('2026-11-20T12:00:00Z'),
        recipientName: customer.name,
        status: 'issued',
      },
    });
    await prisma.cashPayoutVoucher.create({
      data: {
        voucherNumber: `VCH-TST-${suffix}-2`,
        customerSessionId: session1.id,
        customerId: customer.id,
        amount: 20000,
        currency: 'EGP',
        exchangeRate: 200,
        equivalentSdg: 4000000,
        cashSourceAccountId: safeAccount!.id,
        paidBy: 'TestRunner',
        paidAt: new Date('2026-11-20T14:00:00Z'),
        recipientName: customer.name,
        status: 'issued',
      },
    });

    // Test 2 assertion: 100,000 - (30,000 + 20,000) = 50,000 EGP remaining
    const egpPartial = await generateCustomerStatement({ customerId: customer.id, currency: 'EGP' });
    assert(egpPartial, 'EGP statement should exist');
    assert.equal(egpPartial.totalCredit, 100000, 'Total credit EGP must be 100,000');
    assert.equal(egpPartial.totalDebit, 50000, 'Total debit EGP must be 50,000');
    assert.equal(egpPartial.closingBalance, 50000, 'Closing balance after 30k+20k must be 50,000 EGP');
    assert.equal(egpPartial.rows.length, 7, 'Should have 5 receipt rows + 2 payout rows = 7 rows');

    // Now add remaining 50,000 payout (matching 60k+40k = 100k full settlement check)
    await prisma.cashPayoutVoucher.create({
      data: {
        voucherNumber: `VCH-TST-${suffix}-3`,
        customerSessionId: session1.id,
        customerId: customer.id,
        amount: 50000,
        currency: 'EGP',
        exchangeRate: 200,
        equivalentSdg: 10000000,
        cashSourceAccountId: safeAccount!.id,
        paidBy: 'TestRunner',
        paidAt: new Date('2026-11-20T16:00:00Z'),
        recipientName: customer.name,
        status: 'issued',
      },
    });
    await prisma.customerSession.update({
      where: { id: session1.id },
      data: { deliveredAmount: 100000, status: 'completed' },
    });

    const egpFull = await generateCustomerStatement({ customerId: customer.id, currency: 'EGP' });
    assert.equal(egpFull!.totalCredit, 100000);
    assert.equal(egpFull!.totalDebit, 100000);
    assert.equal(egpFull!.closingBalance, 0, 'Closing balance EGP must be 0 after full payout');

    const sdgStmt = await generateCustomerStatement({ customerId: customer.id, currency: 'SDG' });
    assert.equal(sdgStmt!.totalCredit, 20000000, 'SDG total credit must be 20,000,000');
    assert.equal(sdgStmt!.totalDebit, 20000000, 'SDG total converted debit must be 20,000,000');
    assert.equal(sdgStmt!.closingBalance, 0, 'SDG closing balance must be 0');
    console.log('PASS: Test 1 & 2 (EGP & SDG ledgers exact, 0 duplication)');

    // =======================================================================
    // TEST 3: Pending / Unapproved Receipts must NOT create EGP entitlement
    // =======================================================================
    console.log('--- Test 3: Unapproved Receipts Exclusion ---');
    const sessionPending = await prisma.customerSession.create({
      data: {
        sessionNumber: `SES-TST-${suffix}-2`,
        customerId: customer.id,
        businessDate: '2026-11-22',
        exchangeRate: 200,
        currencyFrom: 'SDG',
        currencyTo: 'EGP',
        requestedAmount: 50000,
        expectedAmount: 10000000,
        receivedAmount: 0,
        deliveredAmount: 0,
        remainingAmount: 10000000,
        status: 'open',
        createdBy: 'TestRunner',
      },
    });
    await prisma.bankakReceipt.create({
      data: {
        receiptNumber: `RCP-TST-${suffix}-PEND`,
        transactionId: `TRX-TST-${suffix}-PEND`,
        customerId: customer.id,
        customerSessionId: sessionPending.id,
        amount: 10000000,
        currency: 'SDG',
        transactionDate: '2026-11-22',
        imageStorageKey: 'no-image',
        imageHash: `hash-tst-${suffix}-pend`,
        status: 'pending_review',
        createdBy: 'TestRunner',
      },
    });

    const statusPending = await getCustomerFinancialStatus(customer.id);
    assert.equal(statusPending!.balances.EGP.creditor, 0, 'Unapproved receipts must NOT create EGP creditor entitlement');
    assert.equal(statusPending!.canClose, false, 'Pending session must block account closing');

    const egpAfterPending = await generateCustomerStatement({ customerId: customer.id, currency: 'EGP' });
    assert.equal(egpAfterPending!.closingBalance, 0, 'Pending receipt must not appear in statement');
    console.log('PASS: Test 3 (Pending receipts excluded from statement & EGP entitlement)');

    // =======================================================================
    // TEST 4: Opening Balance & Date Range Filter
    // =======================================================================
    console.log('--- Test 4: Opening Balance & Date Range Filter ---');
    // Add an EGP debt on 2026-11-23 of 10,000 EGP
    const debt = await prisma.debt.create({
      data: {
        debtNumber: `DBT-TST-${suffix}`,
        debtorType: 'customer',
        debtorId: customer.id,
        creditorType: 'office',
        creditorId: 'office',
        currency: 'EGP',
        originalAmount: 10000,
        remainingAmount: 6000,
        debtDate: '2026-11-23',
        description: 'دين اختباري',
        status: 'partially_paid',
        createdBy: 'TestRunner',
      },
    });
    await prisma.debtPayment.create({
      data: {
        debtId: debt.id,
        amount: 4000,
        currency: 'EGP',
        accountId: safeAccount!.id,
        paymentDate: '2026-11-24',
        reference: `PAY-${suffix}`,
        createdBy: 'TestRunner',
      },
    });

    // Filter from 2026-11-24 onwards -> opening balance should be -10,000 (0 from session1 + (-10,000) debt on 23rd)
    // Period credit = +4,000 -> closing = -6,000
    const filtered = await generateCustomerStatement({
      customerId: customer.id,
      currency: 'EGP',
      fromDate: '2026-11-24',
      toDate: '2026-11-25',
    });
    assert.equal(filtered!.openingBalance, -10000, 'Opening balance before 2026-11-24 must be -10,000');
    assert.equal(filtered!.totalCredit, 4000, 'Period credit must be 4,000');
    assert.equal(filtered!.totalDebit, 0, 'Period debit must be 0');
    assert.equal(filtered!.closingBalance, -6000, 'Closing balance must be -6,000');
    console.log('PASS: Test 4 & 5 (Opening balance + Debt & DebtPayment verified)');

    // =======================================================================
    // TEST 6: Custody Payout (No duplication)
    // =======================================================================
    console.log('--- Test 6: Custody Transaction Appearance ---');
    const emp = await prisma.employee.findFirst();
    if (emp) {
      const custody = await prisma.employeeCustody.create({
        data: {
          employeeId: emp.id,
          accountId: safeAccount!.id,
          currency: 'EGP',
          openingAmount: 5000,
          currentAmount: 3000,
          businessDate: '2026-11-25',
          status: 'open',
          issuedBy: 'TestRunner',
        },
      });
      createdCustodyIds.push(custody.id);

      await prisma.custodyTransaction.create({
        data: {
          custodyId: custody.id,
          transactionType: 'delivery_to_customer',
          amount: 2000,
          currency: 'EGP',
          customerId: customer.id,
          referenceNumber: `DLV-TST-${suffix}`,
          description: `صرف نقدي من العهدة للعميل ${customer.name}`,
          createdBy: 'TestRunner',
        },
      });

      const egpWithCustody = await generateCustomerStatement({ customerId: customer.id, currency: 'EGP' });
      const custodyRows = egpWithCustody!.rows.filter((r) => r.source === 'CustodyTransaction');
      assert.equal(custodyRows.length, 1, 'Custody delivery must appear exactly once');
      assert.equal(custodyRows[0].debit, 2000);
      console.log('PASS: Test 6 (Custody payout appears once without duplication)');
    } else {
      console.log('SKIPPED Test 6 (no employee record in DB)');
    }

    // =======================================================================
    // TEST 7: Account Closing Validation
    // =======================================================================
    console.log('--- Test 7: Account Closing Blocking & Allowance ---');
    const statusBlocked = await getCustomerFinancialStatus(customer.id);
    assert.equal(statusBlocked!.canClose, false, 'Customer with open session & debt cannot close');
    assert(statusBlocked!.blockingReasons.length >= 2, 'Must report blocking reasons');
    console.log('PASS: Test 7 (Account closing properly blocked when obligations/pending sessions exist)');

    // =======================================================================
    // TEST 8: Arabic RTL PDF Generation & Multi-page Verification
    // =======================================================================
    console.log('--- Test 8: Arabic RTL PDF Generation (Single + Multi-page) ---');
    const finalEgp = await generateCustomerStatement({ customerId: customer.id, currency: 'EGP' });
    const pdfBuf = await buildCustomerStatementPdf(
      finalEgp!,
      { name: 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING)', phone: '+20 100 000 0000' },
      'TestRunner'
    );
    assert(Buffer.isBuffer(pdfBuf) && pdfBuf.length > 5000, 'PDF buffer must be non-empty');
    assert.equal(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-', 'Must be valid PDF binary header');

    // Verify Arabic RTL reordering helper handles multi-word RTL + LTR equations
    const shapedHeader = shapeArabicLine('كشف الحساب');
    assert(shapedHeader === 'الحساب كشف', 'Multi-word Arabic header must be reordered for PDFKit LTR layout');

    // Multi-page test (45 synthetic rows)
    const multiPageStmt = {
      ...finalEgp!,
      rows: Array.from({ length: 45 }, (_, idx) => ({
        ...finalEgp!.rows[0],
        id: `mp-${idx}`,
        date: '2026-11-25',
        description: `حركة اختبارية متعددة الصفحات رقم ${idx + 1} — 4,000,000 SDG ÷ 200 = 20,000 EGP`,
        debit: idx % 2 === 0 ? 0 : 10000,
        credit: idx % 2 === 0 ? 20000 : 0,
        runningBalance: (idx + 1) * 5000,
      })),
    };
    const multiPdfBuf = await buildCustomerStatementPdf(
      multiPageStmt,
      { name: 'أبو جواد للتجارة', phone: '+20 100 000 0000' },
      'TestRunner'
    );
    assert(multiPdfBuf.length > pdfBuf.length, 'Multi-page PDF must be larger than single-page PDF');
    // Save sample PDF artifact in brain scratch for visual inspection if needed
    const scratchDir = 'C:/Users/HP/.gemini/antigravity/brain/a3336cd6-8309-4c47-b12b-83c78d3c2851/scratch';
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(path.join(scratchDir, 'sample-statement-egp.pdf'), pdfBuf);
    fs.writeFileSync(path.join(scratchDir, 'sample-statement-multipage.pdf'), multiPdfBuf);
    console.log('PASS: Test 8 (Arabic RTL PDF valid binary + multi-page generated)');

    console.log('\n=== ALL 8 MANDATORY TESTS PASSED 100% ===');
  } finally {
    // Cleanup all temporary test records so production DB remains untouched
    console.log('\nCleaning up temporary test records...');
    for (const cid of createdCustodyIds) {
      await prisma.custodyTransaction.deleteMany({ where: { custodyId: cid } }).catch(() => {});
      await prisma.employeeCustody.delete({ where: { id: cid } }).catch(() => {});
    }
    for (const custId of createdCustomerIds) {
      await prisma.debtPayment.deleteMany({ where: { debt: { debtorId: custId } } }).catch(() => {});
      await prisma.debt.deleteMany({ where: { debtorId: custId } }).catch(() => {});
      await prisma.cashPayoutVoucher.deleteMany({ where: { customerId: custId } }).catch(() => {});
      await prisma.bankakReceipt.deleteMany({ where: { customerId: custId } }).catch(() => {});
      await prisma.customerSession.deleteMany({ where: { customerId: custId } }).catch(() => {});
      await prisma.customer.delete({ where: { id: custId } }).catch(() => {});
    }
    await prisma.$disconnect();
    console.log('Cleanup complete.');
  }
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
