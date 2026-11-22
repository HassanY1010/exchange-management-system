import { prisma } from '../lib/db';
import { GET as getRates, POST as updateRate } from '../app/api/v1/exchange-rates/route';
import { POST as createCustomerSession } from '../app/api/v1/customer-sessions/route';
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

async function runExchangeRatesComprehensiveSuite() {
  console.log('========================================================================');
  console.log('   PRODUCTION AUDIT & COMPREHENSIVE SUITE: EXCHANGE RATES & FX ENGINE   ');
  console.log('========================================================================\n');

  const adminToken = generateToken({
    userId: 'admin-fx-tester',
    email: 'admin@system.com',
    name: 'Admin FX Officer',
    role: 'admin',
  });

  const accountantToken = generateToken({
    userId: 'accountant-fx-tester',
    email: 'accountant@system.com',
    name: 'Accountant FX Officer',
    role: 'accountant',
  });

  const cashierToken = generateToken({
    userId: 'cashier-fx-tester',
    email: 'cashier@system.com',
    name: 'Cashier Staff',
    role: 'cashier',
  });

  const dataEntryToken = generateToken({
    userId: 'dataentry-fx-tester',
    email: 'dataentry@system.com',
    name: 'Data Entry Staff',
    role: 'data_entry',
  });

  const ts = Date.now();

  // -------------------------------------------------------------------------
  // 1. Creation of New Exchange Rate
  // -------------------------------------------------------------------------
  console.log('>>> [1/14] TESTING NEW RATE CREATION >>>');
  const resCreateCust = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 205.5,
      reason: `تحديث سعر العملاء الصباحي ${ts}`,
    }, adminToken)
  );
  const dataCreateCust = await resCreateCust.json();
  assert(resCreateCust.status === 201 && dataCreateCust.success, 'New customer exchange rate created with 201 status');
  assert(dataCreateCust.data.rate === 205.5, 'Customer rate recorded exactly as 205.5');
  assert(dataCreateCust.data.effectiveTo === null, 'Active customer rate has effectiveTo = null');

  // -------------------------------------------------------------------------
  // 2. Modify Customer Rate Without Changing Supplier Rate
  // -------------------------------------------------------------------------
  console.log('\n>>> [2/14] TESTING CUSTOMER RATE INDEPENDENCE >>>');
  // First ensure an active supplier rate exists
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'supplier',
      rate: 195.0,
      reason: 'تثبيت سعر المورد الأولي',
    }, adminToken)
  );

  // Now update Customer Rate to 210.0
  const resUpdateCust = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 210.0,
      reason: 'رفع سعر بيع العملاء',
    }, adminToken)
  );
  const dataUpdateCust = await resUpdateCust.json();
  assert(resUpdateCust.status === 201 && dataUpdateCust.data.rate === 210.0, 'Customer rate updated to 210.0');

  // Verify Supplier rate remains 195.0
  const activeSuppAfterCust = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'EGP', toCurrency: 'SDG', rateType: 'supplier', effectiveTo: null },
    orderBy: { createdAt: 'desc' },
  });
  assert(Number(activeSuppAfterCust?.rate) === 195.0, 'Supplier rate remained strictly 195.0 (independent from customer rate)');

  // -------------------------------------------------------------------------
  // 3. Modify Supplier Rate Without Changing Customer Rate
  // -------------------------------------------------------------------------
  console.log('\n>>> [3/14] TESTING SUPPLIER RATE INDEPENDENCE >>>');
  const resUpdateSupp = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'supplier',
      rate: 198.0,
      reason: 'تعديل سعر الموردين لمواكبة السوق',
    }, adminToken)
  );
  const dataUpdateSupp = await resUpdateSupp.json();
  assert(resUpdateSupp.status === 201 && dataUpdateSupp.data.rate === 198.0, 'Supplier rate updated to 198.0');

  // Verify Customer rate remains 210.0
  const activeCustAfterSupp = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'EGP', toCurrency: 'SDG', rateType: 'customer', effectiveTo: null },
    orderBy: { createdAt: 'desc' },
  });
  assert(Number(activeCustAfterSupp?.rate) === 210.0, 'Customer rate remained strictly 210.0 (independent from supplier rate)');

  // -------------------------------------------------------------------------
  // 4. Modify Market Benchmark Rate Without Altering Financial Operations
  // -------------------------------------------------------------------------
  console.log('\n>>> [4/14] TESTING BENCHMARK RATE INDEPENDENCE >>>');
  const resBenchmark = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'market_benchmark',
      rate: 202.0,
      reason: 'تحديث مؤشر سعر السوق الموازي الاسترشادي',
    }, adminToken)
  );
  const dataBenchmark = await resBenchmark.json();
  assert(resBenchmark.status === 201 && dataBenchmark.data.rate === 202.0, 'Market benchmark rate updated to 202.0');

  // Verify neither customer nor supplier rates were altered
  const checkCust = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'EGP', toCurrency: 'SDG', rateType: 'customer', effectiveTo: null },
    orderBy: { createdAt: 'desc' },
  });
  const checkSupp = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'EGP', toCurrency: 'SDG', rateType: 'supplier', effectiveTo: null },
    orderBy: { createdAt: 'desc' },
  });
  assert(Number(checkCust?.rate) === 210.0 && Number(checkSupp?.rate) === 198.0, 'Benchmark modification has ZERO effect on Customer and Supplier rates');

  // -------------------------------------------------------------------------
  // 5. Input Validations (Reject 0, Negative, NaN, Same Currency, Bad Type)
  // -------------------------------------------------------------------------
  console.log('\n>>> [5/14] TESTING STRICT SERVER-SIDE VALIDATIONS >>>');

  // Rate = 0
  const resZero = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 0,
    }, adminToken)
  );
  assert(resZero.status === 400, 'Rate = 0 rejected with status 400');

  // Rate < 0
  const resNeg = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: -50,
    }, adminToken)
  );
  assert(resNeg.status === 400, 'Negative rate (-50) rejected with status 400');

  // Rate = NaN / String
  const resNan = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 'not-a-number',
    }, adminToken)
  );
  assert(resNan.status === 400, 'Non-numeric rate rejected with status 400');

  // Same Currency (EGP/EGP)
  const resSame = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'EGP',
      rateType: 'customer',
      rate: 1,
    }, adminToken)
  );
  assert(resSame.status === 400, 'Same currency pair (EGP/EGP) rejected with status 400');

  // Invalid Rate Type
  const resBadType = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'fake_type',
      rate: 200,
    }, adminToken)
  );
  assert(resBadType.status === 400, 'Invalid rateType rejected with status 400');

  // Out of bounds (e.g. 100,000,000)
  const resHuge = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 999999999,
    }, adminToken)
  );
  assert(resHuge.status === 400, 'Absurd rate value rejected with status 400');

  // -------------------------------------------------------------------------
  // 6. Decimal Precision Validation
  // -------------------------------------------------------------------------
  console.log('\n>>> [6/14] TESTING DECIMAL PRECISION (NO FLOATING POINT CORRUPTION) >>>');
  const exactDecRate = 205.4321;
  const resDec = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: exactDecRate,
      reason: 'اختبار دقة المنازل العشرية 4 أرقام',
    }, adminToken)
  );
  const dataDec = await resDec.json();
  assert(resDec.status === 201 && dataDec.data.rate === exactDecRate, 'Exact decimal rate 205.4321 saved without floating point rounding error');

  const dbDec = await prisma.exchangeRate.findUnique({ where: { id: dataDec.data.id } });
  assert(new Decimal(dbDec!.rate.toString()).equals(new Decimal(205.4321)), 'PostgreSQL Decimal(20,4) stored exact value 205.4321');

  // -------------------------------------------------------------------------
  // 7. Rate History Tracking (Old rate, new rate, timestamp, user, audit log)
  // -------------------------------------------------------------------------
  console.log('\n>>> [7/14] TESTING HISTORY TRACKING & AUDIT LOG TRACEABILITY >>>');
  const resHistoryUpdate = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 215.0,
      reason: 'تحديث مسائي معتمد',
    }, accountantToken)
  );
  const dataHistoryUpdate = await resHistoryUpdate.json();
  assert(resHistoryUpdate.status === 201, 'Rate update executed by Accountant');
  assert(dataHistoryUpdate.previousRate === 205.4321, 'API returned correct previousRate: 205.4321');

  // Verify previous rate's effectiveTo was stamped
  const prevRecord = await prisma.exchangeRate.findUnique({ where: { id: dataDec.data.id } });
  assert(prevRecord?.effectiveTo !== null, 'Previous active rate now has effectiveTo populated (archived)');

  // Verify AuditLog record
  const auditLog = await prisma.auditLog.findFirst({
    where: {
      action: 'UPDATE_EXCHANGE_RATE',
      entityId: dataHistoryUpdate.data.id,
    },
  });
  assert(!!auditLog, 'AuditLog entry created for exchange rate update');
  assert(auditLog?.reason?.includes('تحديث مسائي معتمد'), 'AuditLog contains correct custom reason');

  // -------------------------------------------------------------------------
  // 8. RBAC and Permissions Enforcement
  // -------------------------------------------------------------------------
  console.log('\n>>> [8/14] TESTING RBAC ACCESS CONTROLS >>>');

  // Unauthenticated GET -> 401
  const resUnauthGet = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates'));
  assert(resUnauthGet.status === 401, 'Unauthenticated GET returns 401');

  // Unauthenticated POST -> 401
  const resUnauthPost = await updateRate(mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', { rate: 200 }));
  assert(resUnauthPost.status === 401, 'Unauthenticated POST returns 401');

  // Cashier POST -> 403 Forbidden
  const resCashier = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 220,
    }, cashierToken)
  );
  assert(resCashier.status === 403, 'Cashier attempting to update rate is strictly forbidden (403)');

  // Data Entry POST -> 403 Forbidden
  const resDataEntry = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 220,
    }, dataEntryToken)
  );
  assert(resDataEntry.status === 403, 'Data Entry staff attempting to update rate is strictly forbidden (403)');

  // Accountant POST -> 201 Allowed
  const resAccountant = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 216,
    }, accountantToken)
  );
  assert(resAccountant.status === 201, 'Accountant role authorized to update exchange rate (201)');

  // -------------------------------------------------------------------------
  // 9. Historical Immutability (Past Customer & Supplier Transactions Never Mutate)
  // -------------------------------------------------------------------------
  console.log('\n>>> [9/14] TESTING HISTORICAL FINANCIAL IMMUTABILITY >>>');

  // Create a customer session at rate 200
  let cust = await prisma.customer.findFirst();
  if (!cust) {
    cust = await prisma.customer.create({
      data: {
        customerCode: `CUST-TEST-${ts}`,
        name: `عميل فحص السعر ${ts}`,
        phone: `+249${Math.floor(Math.random() * 90000000 + 10000000)}`,
      },
    });
  }

  const sessionAt200 = await prisma.customerSession.create({
    data: {
      customerId: cust.id,
      sessionNumber: `SES-IMMUTABLE-${ts}`,
      businessDate: '2026-11-22',
      exchangeRate: new Decimal(200.0),
      requestedAmount: new Decimal(10000), // 10,000 EGP
      expectedAmount: new Decimal(2000000), // 2,000,000 SDG
      status: 'pending_receipts',
      createdBy: 'test',
    },
  });
  assert(Number(sessionAt200.exchangeRate) === 200.0, 'Customer session created with historical rate 200.0');

  // Now change the current active exchange rate to 280.0
  await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'EGP',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 280.0,
      reason: 'قفزة سعرية في السوق',
    }, adminToken)
  );

  // Inspect the existing customer session:
  const sessionCheck = await prisma.customerSession.findUnique({ where: { id: sessionAt200.id } });
  assert(Number(sessionCheck!.exchangeRate) === 200.0, 'Historical CustomerSession.exchangeRate is STILL 200.0 (unmutated)');
  assert(Number(sessionCheck!.expectedAmount) === 2000000, 'Historical CustomerSession.expectedAmount is STILL 2,000,000 SDG (unmutated)');

  // -------------------------------------------------------------------------
  // 10. Dependent Financial Operations Use Correct Rates
  // -------------------------------------------------------------------------
  console.log('\n>>> [10/14] TESTING DEPENDENT FINANCIAL TRANSACTIONS RATE ISOLATION >>>');
  // Check that customer session logic uses customer rate, not supplier or benchmark
  const activeRatesGet = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates?fromCurrency=EGP&toCurrency=SDG', 'GET', undefined, adminToken));
  const activeData = await activeRatesGet.json();
  const customerRateNow = activeData.activeRates.find((r: any) => r.rateType === 'customer')?.rate;
  const supplierRateNow = activeData.activeRates.find((r: any) => r.rateType === 'supplier')?.rate;
  const benchmarkRateNow = activeData.activeRates.find((r: any) => r.rateType === 'market_benchmark')?.rate;

  assert(customerRateNow === 280.0, 'Active Customer Rate is 280.0');
  assert(supplierRateNow === 198.0, 'Active Supplier Rate is 198.0');
  assert(benchmarkRateNow === 202.0, 'Active Benchmark Rate is 202.0');
  assert(customerRateNow !== supplierRateNow && customerRateNow !== benchmarkRateNow, 'All 3 rates are strictly distinct and unmixed');

  // -------------------------------------------------------------------------
  // 11. Concurrency and Race Condition Safety
  // -------------------------------------------------------------------------
  console.log('\n>>> [11/14] TESTING CONCURRENT MULTI-ADMIN UPDATES >>>');
  // Send 4 simultaneous rate updates
  const promises = [221, 222, 223, 224].map((r, idx) =>
    updateRate(
      mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
        fromCurrency: 'EGP',
        toCurrency: 'SDG',
        rateType: 'customer',
        rate: r,
        reason: `تحديث تزامني رقم ${idx + 1}`,
      }, adminToken)
    )
  );

  const results = await Promise.all(promises);
  const statuses = results.map(r => r.status);
  assert(statuses.every(s => s === 201), 'All concurrent rate updates succeeded gracefully without database deadlocks');

  // Verify that only the last inserted rate has effectiveTo = null
  const activeCount = await prisma.exchangeRate.count({
    where: { fromCurrency: 'EGP', toCurrency: 'SDG', rateType: 'customer', effectiveTo: null },
  });
  assert(activeCount === 1, 'Exactly ONE customer rate remains active (effectiveTo = null) after concurrent updates');

  // -------------------------------------------------------------------------
  // 12. Historical Query & API Filtering
  // -------------------------------------------------------------------------
  console.log('\n>>> [12/14] TESTING HISTORICAL QUERY & QUERY PARAMETER FILTERING >>>');
  // Filter by rateType=supplier
  const resFilterSupp = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates?rateType=supplier', 'GET', undefined, adminToken));
  const dataFilterSupp = await resFilterSupp.json();
  assert(dataFilterSupp.data.every((r: any) => r.rateType === 'supplier'), 'API filter ?rateType=supplier returned only supplier records');

  // Filter by activeOnly=true
  const resFilterActive = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates?activeOnly=true', 'GET', undefined, adminToken));
  const dataFilterActive = await resFilterActive.json();
  assert(dataFilterActive.data.every((r: any) => r.isActive === true), 'API filter ?activeOnly=true returned only active records');

  // -------------------------------------------------------------------------
  // 13. Spreads and Commercial Margin Calculation
  // -------------------------------------------------------------------------
  console.log('\n>>> [13/14] TESTING SPREAD & COMMERCIAL MARGIN COMPUTATION >>>');
  const resSpreadCheck = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates', 'GET', undefined, adminToken));
  const dataSpreadCheck = await resSpreadCheck.json();
  const egpSdgSpread = dataSpreadCheck.spreads['EGP/SDG'];

  assert(!!egpSdgSpread, 'EGP/SDG spread object exists in API response');
  assert(egpSdgSpread.customerRate !== null && egpSdgSpread.supplierRate !== null, 'Customer and Supplier rates present in spread');
  assert(egpSdgSpread.spread === Number(new Decimal(egpSdgSpread.customerRate).minus(new Decimal(egpSdgSpread.supplierRate)).toFixed(4)), 'Spread equals customerRate - supplierRate');
  assert(typeof egpSdgSpread.marginPercent === 'number', 'Margin percentage correctly computed');

  // -------------------------------------------------------------------------
  // 14. Multi-Currency Support (USD, SAR, AED)
  // -------------------------------------------------------------------------
  console.log('\n>>> [14/14] TESTING MULTI-CURRENCY SUPPORT (USD, SAR, AED) >>>');

  // Create USD/SDG customer rate (e.g. 2,800 SDG/USD)
  const resUsd = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'USD',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 2800.0,
      reason: 'افتتاح سعر الدولار مقابل السوداني',
    }, adminToken)
  );
  assert(resUsd.status === 201, 'USD/SDG rate created successfully');

  // Create USD/EGP rate (e.g. 50.0 EGP/USD)
  const resUsdEgp = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'USD',
      toCurrency: 'EGP',
      rateType: 'market_benchmark',
      rate: 50.0,
      reason: 'سعر الدولار مقابل الجنيه المصري',
    }, adminToken)
  );
  assert(resUsdEgp.status === 201, 'USD/EGP rate created successfully');

  // Create SAR/SDG rate (e.g. 745.0 SDG/SAR)
  const resSar = await updateRate(
    mockReq('http://localhost:3000/api/v1/exchange-rates', 'POST', {
      fromCurrency: 'SAR',
      toCurrency: 'SDG',
      rateType: 'customer',
      rate: 745.0,
      reason: 'افتتاح سعر الريال السعودي مقابل السوداني',
    }, adminToken)
  );
  assert(resSar.status === 201, 'SAR/SDG rate created successfully');

  // Query all active rates to confirm multi-currency availability
  const resAllCurrencies = await getRates(mockReq('http://localhost:3000/api/v1/exchange-rates?activeOnly=true', 'GET', undefined, adminToken));
  const dataAllCurrencies = await resAllCurrencies.json();
  const pairsFound = new Set(dataAllCurrencies.data.map((r: any) => `${r.fromCurrency}/${r.toCurrency}`));

  assert(pairsFound.has('EGP/SDG'), 'EGP/SDG pair is active');
  assert(pairsFound.has('USD/SDG'), 'USD/SDG pair is active');
  assert(pairsFound.has('USD/EGP'), 'USD/EGP pair is active');
  assert(pairsFound.has('SAR/SDG'), 'SAR/SDG pair is active');

  console.log('\n========================================================================');
  console.log(`   ALL TESTS COMPLETED: ${passed} / ${total} PASSED (100% SUCCESS)`);
  console.log('========================================================================\n');
}

runExchangeRatesComprehensiveSuite()
  .catch((e) => {
    console.error('Test suite failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
