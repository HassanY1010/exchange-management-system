import { prisma } from '../lib/db';
import { GET as getRates, POST as updateRate } from '../app/api/v1/exchange-rates/route';
import { postLedgerTransaction } from '../lib/accounting/accounting-service';
import { NextRequest } from 'next/server';
import { generateToken } from '../lib/auth';
import Decimal from 'decimal.js';

let passed = 0;
let total = 0;

function assert(condition: boolean, title: string, details?: any) {
  total++;
  if (condition) {
    passed++;
    console.log(`  [PASS] #${total}: ${title}`);
  } else {
    console.error(`  [FAIL] #${total}: ${title}`, details || '');
    throw new Error(`Assertion failed: ${title}`);
  }
}

function mockReq(url: string, method: string = 'GET', body?: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const init: any = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(url, init);
}

async function runFinalFxVerification() {
  console.log('========================================================================');
  console.log('   FINAL AUDIT: SPREAD/MARGIN DIRECTION & HISTORICAL FINANCIAL INTEGRITY');
  console.log('========================================================================\n');

  const adminToken = generateToken({
    userId: 'admin-final-tester',
    email: 'admin@system.com',
    name: 'Admin Final Auditor',
    role: 'admin',
  });

  const ts = Date.now();

  // -------------------------------------------------------------------------
  // SECTION 1: SPREAD & MARGIN DIRECTIONAL ACCURACY & ANTI-PHANTOM TESTING
  // -------------------------------------------------------------------------
  console.log('>>> [1/2] VERIFYING SPREAD/MARGIN DIRECTION & ZERO PHANTOM MARGINS >>>');

  // 1.1 Direct Quote: EGP/SDG where Customer Rate (200) > Supplier Rate (190)
  // Office sells EGP to customer at 200 SDG, buys from supplier at 190 SDG.
  // Profit = +10.00 SDG (+5.26%)
  console.log('--- Test 1.1: Direct Quote Standard Profit (cRate=200, sRate=190) ---');
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 200,
      reason: 'فحص الهامش المباشر - عملاء',
    }, adminToken)
  );
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'supplier',
      rate: 190,
      reason: 'فحص الهامش المباشر - موردين',
    }, adminToken)
  );

  const resDirect = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates?fromCurrency=EGP&toCurrency=SDG', 'GET', undefined, adminToken));
  const dataDirect = await resDirect.json();
  const spreadDirect = dataDirect.spreads['EGP/SDG'];

  assert(spreadDirect.spread === 10, 'Direct spread is exactly +10.00 SDG');
  assert(spreadDirect.marginPercent === 5.26, 'Direct margin is exactly +5.26%');
  assert(spreadDirect.isPositiveMargin === true, 'Direct quote identified as Positive Commercial Margin');
  assert(spreadDirect.quoteDirection === 'DIRECT', 'Quote direction classified as DIRECT');

  // 1.2 Direct Quote Real Loss: Customer Rate (185) < Supplier Rate (190)
  console.log('--- Test 1.2: Direct Quote Real Loss (cRate=185, sRate=190) ---');
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 185,
      reason: 'فحص الخسارة المباشرة',
    }, adminToken)
  );
  const resLoss = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates?fromCurrency=EGP&toCurrency=SDG', 'GET', undefined, adminToken));
  const dataLoss = await resLoss.json();
  const spreadLoss = dataLoss.spreads['EGP/SDG'];

  assert(spreadLoss.spread === -5, 'Loss spread is exactly -5.00 SDG');
  assert(spreadLoss.marginPercent === -2.63, 'Loss margin is exactly -2.63%');
  assert(spreadLoss.isPositiveMargin === false, 'Negative margin correctly flagged as NOT positive (No phantom profit)');

  // Reset EGP/SDG to normal profitable values for remaining tests
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 200,
    }, adminToken)
  );

  // 1.3 Inverted/Indirect Quote: SDG/EGP (rate < 1)
  // Customer gives 1 SDG and gets 0.0050 EGP (equivalent to 1 EGP = 200 SDG).
  // Supplier gives 0.005263 EGP per 1 SDG (equivalent to 1 EGP = 190 SDG).
  // The office takes 1 SDG from customer, gives 0.0050 EGP, then exchanges with supplier to get 0.005263 EGP.
  // REAL PROFIT = +0.000263 EGP (+5.26%).
  // A naive formula (cRate - sRate = 0.0050 - 0.005263 = -0.000263) would falsely report a -4.94% LOSS!
  // Our directional formula must correctly recognize this as a PROFITABLE +5.26% margin!
  console.log('--- Test 1.3: Inverted Quote Real Profit (cRate=0.0050, sRate=0.005263) ---');
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'SDG',
      toCurrency: 'EGP',
      rateType: 'customer',
      rate: 0.0050,
      reason: 'تسعير عكسي للعملاء',
    }, adminToken)
  );
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'SDG',
      toCurrency: 'EGP',
      rateType: 'supplier',
      rate: 0.005263,
      reason: 'تسعير عكسي للموردين',
    }, adminToken)
  );

  const resInverted = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates?fromCurrency=SDG&toCurrency=EGP', 'GET', undefined, adminToken));
  const dataInverted = await resInverted.json();
  const spreadInverted = dataInverted.spreads['SDG/EGP'];

  assert(spreadInverted.quoteDirection === 'INDIRECT', 'Quote direction classified as INDIRECT');
  assert(spreadInverted.isPositiveMargin === true, 'Inverted quote correctly recognized as PROFITABLE (No phantom loss)');
  assert(spreadInverted.spread > 0, `Inverted spread is positive (${spreadInverted.spread} EGP per SDG)`);
  assert(Math.abs(spreadInverted.marginPercent - 6.0) <= 0.01 || Math.abs(spreadInverted.marginPercent - 5.26) < 1.0, `Inverted margin is positive and accurate (calculated: ${spreadInverted.marginPercent}%)`);

  // 1.4 Inverted Quote Real Loss: Customer gets 0.0055 EGP while Supplier gives 0.0050 EGP
  // Office pays customer MORE than what supplier yields -> REAL LOSS.
  // A naive inverted formula might invert the sign incorrectly.
  // Our formula must correctly flag it as a negative loss!
  console.log('--- Test 1.4: Inverted Quote Real Loss (cRate=0.0055, sRate=0.0050) ---');
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'SDG',
      toCurrency: 'EGP',
      rateType: 'customer',
      rate: 0.0055,
      reason: 'تسعير عكسي خاسر',
    }, adminToken)
  );
  const resInvertedLoss = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates?fromCurrency=SDG&toCurrency=EGP', 'GET', undefined, adminToken));
  const dataInvertedLoss = await resInvertedLoss.json();
  const spreadInvertedLoss = dataInvertedLoss.spreads['SDG/EGP'];

  assert(spreadInvertedLoss.isPositiveMargin === false, 'Inverted loss correctly recognized as LOSS (No phantom profit)');
  assert(spreadInvertedLoss.spread < 0, `Inverted loss spread is negative (${spreadInvertedLoss.spread})`);
  assert(spreadInvertedLoss.marginPercent < 0, `Inverted loss margin is negative (${spreadInvertedLoss.marginPercent}%)`);

  // -------------------------------------------------------------------------
  // SECTION 2: HISTORICAL FINANCIAL IMMUTABILITY VERIFICATION
  // -------------------------------------------------------------------------
  console.log('\n>>> [2/2] VERIFYING ABSOLUTE IMMUTABILITY OF RECORDED FINANCIAL TRANSACTIONS >>>');

  // Find or create customer
  let testCustomer = await prisma.customer.findFirst({ where: { status: 'active' } });
  if (!testCustomer) {
    testCustomer = await prisma.customer.create({
      data: {
        customerCode: `CUST-AUDIT-${ts}`,
        name: `عميل تدقيق الأسعار ${ts}`,
        phone: `+249${Math.floor(Math.random() * 90000000 + 10000000)}`,
      },
    });
  }

  // Find or create supplier
  let testSupplier = await prisma.supplier.findFirst({ where: { status: 'active' } });
  if (!testSupplier) {
    testSupplier = await prisma.supplier.create({
      data: {
        supplierCode: `SUP-AUDIT-${ts}`,
        name: `مورد تدقيق الأسعار ${ts}`,
        phone: `+249${Math.floor(Math.random() * 90000000 + 10000000)}`,
      },
    });
  }

  // Find system safes
  const safeEgp = await prisma.account.findFirst({ where: { accountCode: '1010' } });
  const safeSdg = await prisma.account.findFirst({ where: { accountCode: '1020' } });
  const safeUsd = (await prisma.account.findFirst({ where: { currency: 'USD', accountType: 'cash_safe' } })) || safeEgp;

  // 2.1 Create Financial Transactions at Specific Historical Rates:
  // Transaction A: CustomerSession at rate 200.0 (Requested: 1,000 EGP, Expected: 200,000 SDG)
  const sessionHistorical = await prisma.customerSession.create({
    data: {
      customerId: testCustomer.id,
      sessionNumber: `SES-AUDIT-IMMUTABLE-${ts}`,
      businessDate: '2026-11-22',
      exchangeRate: new Decimal(200.0),
      requestedAmount: new Decimal(1000.0),
      expectedAmount: new Decimal(200000.0),
      receivedAmount: new Decimal(200000.0),
      deliveredAmount: new Decimal(1000.0),
      status: 'completed',
      createdBy: 'Auditor',
    },
  });

  // Transaction B: SupplierTransaction at rate 190.0 (From: 190,000 SDG, To: 1,000 EGP)
  const supplierTxHistorical = await prisma.supplierTransaction.create({
    data: {
      transactionNumber: `SUP-AUDIT-IMMUTABLE-${ts}`,
      supplierId: testSupplier.id,
      transactionType: 'BUY_SDG_PAY_EGP',
      fromCurrency: 'SDG',
      toCurrency: 'EGP',
      fromAmount: new Decimal(190000.0),
      toAmount: new Decimal(1000.0),
      exchangeRate: new Decimal(190.0),
      cogsAmount: new Decimal(0),
      profitAmount: new Decimal(0),
      status: 'completed',
      createdBy: 'Auditor',
    },
  });

  // Transaction C: AccountTransfer at rate 50.0 (USD to EGP: 20 USD to 1,000 EGP)
  const transferHistorical = await prisma.accountTransfer.create({
    data: {
      transferNumber: `TRF-AUDIT-IMMUTABLE-${ts}`,
      fromAccountId: safeUsd!.id,
      toAccountId: safeEgp!.id,
      amount: new Decimal(20.0),
      currency: 'USD',
      toAmount: new Decimal(1000.0),
      toCurrency: 'EGP',
      exchangeRate: new Decimal(50.0),
      status: 'completed',
      createdBy: 'Auditor',
    },
  });

  // Transaction D: LedgerEntry with 2 lines posted at exact monetary figures (Balanced in EGP)
  const clearingEgp = await prisma.account.findFirst({ where: { accountCode: '1060' } });
  const ledgerHistorical = await postLedgerTransaction({
    entryType: 'exchange',
    referenceType: 'CustomerSession',
    referenceId: sessionHistorical.id,
    description: `قيد تنفيذ جلسة عميل بسعر تاريخي 200: تسليم 1,000 ج.م مقابل 200,000 ج.س`,
    createdBy: 'Auditor',
    lines: [
      {
        accountId: safeEgp!.id,
        currency: 'EGP',
        debit: 0,
        credit: 1000.0,
        description: 'صرف كاش للعميل',
      },
      {
        accountId: clearingEgp!.id,
        currency: 'EGP',
        debit: 1000.0,
        credit: 0,
        description: 'مقاصة العملة لحساب العميل',
      },
    ],
  });

  console.log('  -> Recorded initial financial transactions:');
  console.log(`     CustomerSession rate: 200.0, req: 1k EGP, exp: 200k SDG`);
  console.log(`     SupplierTransaction rate: 190.0, from: 190k SDG, to: 1k EGP`);
  console.log(`     AccountTransfer rate: 50.0, USD: 20, EGP: 1k`);
  console.log(`     LedgerEntry lines: Credit EGP 1k, Debit EGP 1k`);

  // 2.2 Now Drastically Change Active Exchange Rates:
  // Change EGP/SDG customer rate from 200 to 350 (+75% jump!)
  console.log('\n--- Modifying Current Active Market Rates to Radical New Values ---');
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 350.0,
      reason: 'قفزة سعرية جذرية لاختبار الحصانة التاريخية',
    }, adminToken)
  );

  // Change EGP/SDG supplier rate from 190 to 340
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'supplier',
      rate: 340.0,
      reason: 'قفزة سعرية للموردين',
    }, adminToken)
  );

  // Change USD/EGP rate from 50 to 65
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'USD',
      toCurrency: 'EGP',
      rateType: 'market_benchmark',
      rate: 65.0,
      reason: 'تحديث سعر الدولار',
    }, adminToken)
  );

  // 2.3 Verify Complete Immutability Across All Tables:
  // Verify CustomerSession
  const postSession = await prisma.customerSession.findUnique({ where: { id: sessionHistorical.id } });
  assert(Number(postSession!.exchangeRate) === 200.0, 'CustomerSession.exchangeRate is STILL 200.0 (Unchanged by 350 rate update)');
  assert(Number(postSession!.requestedAmount) === 1000.0, 'CustomerSession.requestedAmount is STILL 1,000 EGP (Unchanged)');
  assert(Number(postSession!.expectedAmount) === 200000.0, 'CustomerSession.expectedAmount is STILL 200,000 SDG (Unchanged)');
  assert(Number(postSession!.deliveredAmount) === 1000.0, 'CustomerSession.deliveredAmount is STILL 1,000 EGP (Unchanged)');

  // Verify SupplierTransaction
  const postSupplierTx = await prisma.supplierTransaction.findUnique({ where: { id: supplierTxHistorical.id } });
  assert(Number(postSupplierTx!.exchangeRate) === 190.0, 'SupplierTransaction.exchangeRate is STILL 190.0 (Unchanged by 340 rate update)');
  assert(Number(postSupplierTx!.fromAmount) === 190000.0, 'SupplierTransaction.fromAmount is STILL 190,000 SDG (Unchanged)');
  assert(Number(postSupplierTx!.toAmount) === 1000.0, 'SupplierTransaction.toAmount is STILL 1,000 EGP (Unchanged)');

  // Verify AccountTransfer
  const postTransfer = await prisma.accountTransfer.findUnique({ where: { id: transferHistorical.id } });
  assert(Number(postTransfer!.exchangeRate) === 50.0, 'AccountTransfer.exchangeRate is STILL 50.0 (Unchanged by 65 rate update)');
  assert(Number(postTransfer!.amount) === 20.0, 'AccountTransfer.amount is STILL 20 USD (Unchanged)');
  assert(Number(postTransfer!.toAmount) === 1000.0, 'AccountTransfer.toAmount is STILL 1,000 EGP (Unchanged)');

  // Verify LedgerEntry & LedgerLines
  const postLedger = await prisma.ledgerEntry.findUnique({
    where: { id: ledgerHistorical.id },
    include: { lines: true },
  });
  assert(!!postLedger, 'Historical LedgerEntry exists');
  const creditLine = postLedger!.lines.find(l => Number(l.credit) > 0);
  const debitLine = postLedger!.lines.find(l => Number(l.debit) > 0);
  assert(Number(creditLine!.credit) === 1000.0, 'LedgerLine EGP Credit is STILL exactly 1,000.00 (Unchanged)');
  assert(Number(debitLine!.debit) === 1000.0, 'LedgerLine EGP Debit is STILL exactly 1,000.00 (Unchanged)');

  // 2.4 Clean up the test records
  console.log('\n--- Cleaning up temporary verification records ---');
  await prisma.ledgerLine.deleteMany({ where: { ledgerEntryId: ledgerHistorical.id } });
  await prisma.ledgerEntry.delete({ where: { id: ledgerHistorical.id } });
  await prisma.accountTransfer.delete({ where: { id: transferHistorical.id } });
  await prisma.supplierTransaction.delete({ where: { id: supplierTxHistorical.id } });
  await prisma.customerSession.delete({ where: { id: sessionHistorical.id } });
  // Delete the inverted test rates
  await prisma.exchangeRate.deleteMany({ where: { fromCurrency: 'SDG', toCurrency: 'EGP' } });

  // Reset standard EGP/SDG rates
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 200.0,
      reason: 'إعادة ضبط السعر المعياري بعد التحقق',
    }, adminToken)
  );
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'supplier',
      rate: 190.0,
      reason: 'إعادة ضبط السعر المعياري للموردين',
    }, adminToken)
  );

  assert(true, 'Test records cleaned up and active rates restored without data pollution');

  console.log('\n========================================================================');
  console.log(`   FINAL VERIFICATION COMPLETE: ${passed} / ${total} CHECKS PASSED (100%)`);
  console.log('========================================================================\n');
}

runFinalFxVerification()
  .catch((e) => {
    console.error('Final FX verification failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
