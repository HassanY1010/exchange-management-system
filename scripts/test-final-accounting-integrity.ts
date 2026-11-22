import { prisma } from '../lib/db';
import { GET as getAccounts, POST as createAccount } from '../app/api/v1/accounts/route';
import { POST as createTransfer } from '../app/api/v1/accounts/transfers/route';
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

async function runFinalAccountingIntegrityAudit() {
  console.log('========================================================================');
  console.log('   FINAL PRODUCTION ACCOUNTING INTEGRITY AUDIT: ACCOUNTS & TRANSFERS    ');
  console.log('========================================================================\n');

  const adminToken = generateToken({
    userId: 'audit-admin-id',
    email: 'admin@system.com',
    name: 'Audit Administrator',
    role: 'admin',
  });

  const ts = Date.now();

  // -------------------------------------------------------------------------
  // SECTION 1: OPENING BALANCES AUDIT (EGP, SDG, USD)
  // -------------------------------------------------------------------------
  console.log('>>> [1/3] AUDITING OPENING BALANCES (EGP, SDG, USD) >>>');

  // 1.1 Create EGP Safe with Opening Balance 100,000 EGP
  const egpCode = `101${Math.floor(Math.random() * 900 + 100)}`;
  const egpAmount = 100000;
  const resEgp = await createAccount(
    mockReq('http://localhost:3000/api/v1/accounts', 'POST', {
      name: `خزينة تدقيق مصري ${ts}`,
      accountCode: egpCode,
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: egpAmount,
    }, adminToken)
  );
  const dataEgp = await resEgp.json();
  assert(resEgp.status === 201 && dataEgp.success, 'EGP safe created with 100,000 EGP opening balance');
  const egpAccId = dataEgp.data.id;

  // Verify EGP opening ledger entry
  const egpLedger = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'Account', referenceId: egpAccId, entryType: 'opening_balance' },
    include: { lines: { include: { account: true } } },
  });
  assert(!!egpLedger, 'EGP opening balance ledger entry was automatically generated');
  assert(egpLedger!.lines.length === 2, 'EGP opening ledger entry contains exactly 2 balanced lines');
  
  const egpSafeLine = egpLedger!.lines.find(l => l.accountId === egpAccId);
  const egpCounterLine = egpLedger!.lines.find(l => l.accountId !== egpAccId);
  assert(Number(egpSafeLine?.debit) === egpAmount && Number(egpSafeLine?.credit) === 0, 'Safe line is debited with 100,000 EGP');
  assert(Number(egpCounterLine?.credit) === egpAmount && Number(egpCounterLine?.debit) === 0, 'Counter line is credited with 100,000 EGP');
  assert(egpCounterLine?.account.accountCode === '3010', 'EGP counter account is Capital (3010)');
  assert(egpSafeLine?.currency === 'EGP' && egpCounterLine?.currency === 'EGP', 'No currency mixing: both lines are in EGP');

  // Verify no balance duplication
  const egpAccCheck = await prisma.account.findUnique({ where: { id: egpAccId } });
  assert(Number(egpAccCheck?.currentBalance) === egpAmount, 'EGP currentBalance matches opening balance exactly (no duplication)');

  // 1.2 Create SDG Safe with Opening Balance 5,000,000 SDG
  const sdgCode = `102${Math.floor(Math.random() * 900 + 100)}`;
  const sdgAmount = 5000000;
  const resSdg = await createAccount(
    mockReq('http://localhost:3000/api/v1/accounts', 'POST', {
      name: `خزينة تدقيق سوداني ${ts}`,
      accountCode: sdgCode,
      accountType: 'cash_safe',
      currency: 'SDG',
      openingBalance: sdgAmount,
    }, adminToken)
  );
  const dataSdg = await resSdg.json();
  assert(resSdg.status === 201 && dataSdg.success, 'SDG safe created with 5,000,000 SDG opening balance');
  const sdgAccId = dataSdg.data.id;

  // Verify SDG opening ledger entry
  const sdgLedger = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'Account', referenceId: sdgAccId, entryType: 'opening_balance' },
    include: { lines: { include: { account: true } } },
  });
  assert(!!sdgLedger, 'SDG opening balance ledger entry was automatically generated');
  const sdgSafeLine = sdgLedger!.lines.find(l => l.accountId === sdgAccId);
  const sdgCounterLine = sdgLedger!.lines.find(l => l.accountId !== sdgAccId);
  assert(Number(sdgSafeLine?.debit) === sdgAmount && Number(sdgSafeLine?.credit) === 0, 'SDG safe line is debited with 5,000,000 SDG');
  assert(Number(sdgCounterLine?.credit) === sdgAmount && Number(sdgCounterLine?.debit) === 0, 'SDG counter line is credited with 5,000,000 SDG');
  assert(sdgCounterLine?.account.accountCode === '3010-SDG', 'SDG counter account is Capital SDG (3010-SDG)');
  assert(sdgSafeLine?.currency === 'SDG' && sdgCounterLine?.currency === 'SDG', 'No currency mixing: both lines are in SDG');

  // Verify no balance duplication
  const sdgAccCheck = await prisma.account.findUnique({ where: { id: sdgAccId } });
  assert(Number(sdgAccCheck?.currentBalance) === sdgAmount, 'SDG currentBalance matches opening balance exactly (no duplication)');

  // 1.3 Create USD Safe with Opening Balance 2,000 USD
  const usdCode = `103${Math.floor(Math.random() * 900 + 100)}`;
  const usdAmount = 2000;
  const resUsd = await createAccount(
    mockReq('http://localhost:3000/api/v1/accounts', 'POST', {
      name: `خزينة تدقيق دولار ${ts}`,
      accountCode: usdCode,
      accountType: 'cash_safe',
      currency: 'USD',
      openingBalance: usdAmount,
    }, adminToken)
  );
  const dataUsd = await resUsd.json();
  assert(resUsd.status === 201 && dataUsd.success, 'USD safe created with 2,000 USD opening balance');
  const usdAccId = dataUsd.data.id;

  // Verify USD opening ledger entry
  const usdLedger = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'Account', referenceId: usdAccId, entryType: 'opening_balance' },
    include: { lines: { include: { account: true } } },
  });
  assert(!!usdLedger, 'USD opening balance ledger entry was automatically generated');
  const usdSafeLine = usdLedger!.lines.find(l => l.accountId === usdAccId);
  const usdCounterLine = usdLedger!.lines.find(l => l.accountId !== usdAccId);
  assert(Number(usdSafeLine?.debit) === usdAmount && Number(usdSafeLine?.credit) === 0, 'USD safe line is debited with 2,000 USD');
  assert(Number(usdCounterLine?.credit) === usdAmount && Number(usdCounterLine?.debit) === 0, 'USD counter line is credited with 2,000 USD');
  assert(usdCounterLine?.account.accountCode === '3010-USD', 'USD counter account is Capital USD (3010-USD)');
  assert(usdSafeLine?.currency === 'USD' && usdCounterLine?.currency === 'USD', 'No currency mixing: both lines are in USD');

  // Verify no balance duplication
  const usdAccCheck = await prisma.account.findUnique({ where: { id: usdAccId } });
  assert(Number(usdAccCheck?.currentBalance) === usdAmount, 'USD currentBalance matches opening balance exactly (no duplication)');

  // -------------------------------------------------------------------------
  // SECTION 2: CROSS-CURRENCY TRANSFERS (EGP <-> USD)
  // -------------------------------------------------------------------------
  console.log('\n>>> [2/3] AUDITING CROSS-CURRENCY TRANSFERS (EGP <-> USD) >>>');

  // Baseline check: Record P&L account balance before transfers to verify NO phantom profit/loss is generated
  const profitAccBefore = await prisma.account.findFirst({ where: { accountCode: '4010' } });
  const initialProfitBal = Number(profitAccBefore?.currentBalance || 0);

  // 2.1 Transfer 50,000 EGP -> USD safe (receive 1,000 USD @ rate 0.02)
  console.log('--- Test 2.1: Transfer 50,000 EGP to USD Safe (Get 1,000 USD) ---');
  const resTrf1 = await createTransfer(
    mockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
      fromAccountId: egpAccId, // has 100,000 EGP
      toAccountId: usdAccId,   // has 2,000 USD
      amount: 50000,
      toAmount: 1000,
      exchangeRate: 0.02,
      description: 'تحويل وتغذية دولار من الخزينة المصرية 50,000 ج.م مقابل 1,000 $',
    }, adminToken)
  );
  const dataTrf1 = await resTrf1.json();
  assert(resTrf1.status === 200 && dataTrf1.success, 'Cross-currency transfer EGP -> USD executed successfully');

  // Verify balances after transfer 1
  const egpAfter1 = await prisma.account.findUnique({ where: { id: egpAccId } });
  const usdAfter1 = await prisma.account.findUnique({ where: { id: usdAccId } });
  assert(Number(egpAfter1?.currentBalance) === 50000, 'EGP safe balance deducted by exactly 50,000 EGP (100k -> 50k)');
  assert(Number(usdAfter1?.currentBalance) === 3000, 'USD safe balance credited with exactly 1,000 USD (2,000 -> 3,000)');

  // Verify AccountTransfer record
  const trf1Record = await prisma.accountTransfer.findUnique({
    where: { transferNumber: dataTrf1.data.transferNumber },
  });
  assert(!!trf1Record, 'Transfer record 1 persisted in AccountTransfer');
  assert(Number(trf1Record?.amount) === 50000 && trf1Record?.currency === 'EGP', 'Transfer 1 source amount is 50,000 EGP');
  assert(Number(trf1Record?.toAmount) === 1000 && trf1Record?.toCurrency === 'USD', 'Transfer 1 dest amount is 1,000 USD');
  assert(Number(trf1Record?.exchangeRate) === 0.02, 'Transfer 1 exchange rate is exactly 0.02');

  // Verify the 2 ledger legs for Transfer 1
  const leg1From = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'AccountTransfer', referenceId: trf1Record?.transferNumber, entryType: 'fund_transfer_cross_from' },
    include: { lines: { include: { account: true } } },
  });
  const leg1To = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'AccountTransfer', referenceId: trf1Record?.transferNumber, entryType: 'fund_transfer_cross_to' },
    include: { lines: { include: { account: true } } },
  });
  assert(!!leg1From && !!leg1To, 'Both cross-currency ledger legs exist independently');

  // Leg 1 (EGP leg): Debit 1060 (EGP), Credit Safe EGP
  const debitLeg1 = leg1From!.lines.reduce((s, l) => s + Number(l.debit), 0);
  const creditLeg1 = leg1From!.lines.reduce((s, l) => s + Number(l.credit), 0);
  assert(debitLeg1 === creditLeg1 && debitLeg1 === 50000, 'Leg 1 (EGP) balances perfectly at 50,000 EGP');
  const leg1ClearingLine = leg1From!.lines.find(l => l.account.accountCode.startsWith('106'));
  assert(leg1ClearingLine?.currency === 'EGP', 'Leg 1 clearing line is strictly in EGP (1060)');

  // Leg 2 (USD leg): Debit Safe USD, Credit 1060-USD (USD)
  const debitLeg2 = leg1To!.lines.reduce((s, l) => s + Number(l.debit), 0);
  const creditLeg2 = leg1To!.lines.reduce((s, l) => s + Number(l.credit), 0);
  assert(debitLeg2 === creditLeg2 && debitLeg2 === 1000, 'Leg 2 (USD) balances perfectly at 1,000 USD');
  const leg2ClearingLine = leg1To!.lines.find(l => l.account.accountCode.startsWith('106'));
  assert(leg2ClearingLine?.currency === 'USD', 'Leg 2 clearing line is strictly in USD (1060-USD)');

  // 2.2 Reverse Transfer: 200 USD -> EGP safe (receive 10,000 EGP @ rate 50)
  console.log('--- Test 2.2: Reverse Transfer 200 USD to EGP Safe (Get 10,000 EGP) ---');
  const resTrf2 = await createTransfer(
    mockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
      fromAccountId: usdAccId, // has 3,000 USD
      toAccountId: egpAccId,   // has 50,000 EGP
      amount: 200,
      toAmount: 10000,
      exchangeRate: 50,
      description: 'تحويل عكسي: بيع 200 دولار مقابل 10,000 جنيه مصري',
    }, adminToken)
  );
  const dataTrf2 = await resTrf2.json();
  assert(resTrf2.status === 200 && dataTrf2.success, 'Reverse cross-currency transfer USD -> EGP executed successfully');

  // Verify balances after reverse transfer 2
  const egpAfter2 = await prisma.account.findUnique({ where: { id: egpAccId } });
  const usdAfter2 = await prisma.account.findUnique({ where: { id: usdAccId } });
  assert(Number(usdAfter2?.currentBalance) === 2800, 'USD safe balance deducted by 200 USD (3,000 -> 2,800)');
  assert(Number(egpAfter2?.currentBalance) === 60000, 'EGP safe balance credited with 10,000 EGP (50,000 -> 60,000)');

  // Verify reverse transfer ledger legs
  const trf2Record = await prisma.accountTransfer.findUnique({
    where: { transferNumber: dataTrf2.data.transferNumber },
  });
  const leg2From = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'AccountTransfer', referenceId: trf2Record?.transferNumber, entryType: 'fund_transfer_cross_from' },
    include: { lines: { include: { account: true } } },
  });
  const leg2To = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'AccountTransfer', referenceId: trf2Record?.transferNumber, entryType: 'fund_transfer_cross_to' },
    include: { lines: { include: { account: true } } },
  });
  assert(!!leg2From && !!leg2To, 'Both reverse transfer ledger legs exist independently');

  // Reverse Leg 1 (USD leg): Debit 1060-USD (USD), Credit Safe USD
  const debitRev1 = leg2From!.lines.reduce((s, l) => s + Number(l.debit), 0);
  const creditRev1 = leg2From!.lines.reduce((s, l) => s + Number(l.credit), 0);
  assert(debitRev1 === creditRev1 && debitRev1 === 200, 'Reverse Leg 1 (USD) balances perfectly at 200 USD');

  // Reverse Leg 2 (EGP leg): Debit Safe EGP, Credit 1060 (EGP)
  const debitRev2 = leg2To!.lines.reduce((s, l) => s + Number(l.debit), 0);
  const creditRev2 = leg2To!.lines.reduce((s, l) => s + Number(l.credit), 0);
  assert(debitRev2 === creditRev2 && debitRev2 === 10000, 'Reverse Leg 2 (EGP) balances perfectly at 10,000 EGP');

  // 2.3 Verify ZERO Phantom Profit / Loss
  const profitAccAfter = await prisma.account.findFirst({ where: { accountCode: '4010' } });
  const finalProfitBal = Number(profitAccAfter?.currentBalance || 0);
  assert(finalProfitBal === initialProfitBal, 'Zero phantom profit/loss: Account 4010 balance is strictly unchanged');

  // -------------------------------------------------------------------------
  // SECTION 3: GENERAL LEDGER RECONCILIATION AUDIT
  // -------------------------------------------------------------------------
  console.log('\n>>> [3/3] AUDITING GENERAL LEDGER RECONCILIATION & SCOPE >>>');

  const resAccounts = await getAccounts(mockReq('http://localhost:3000/api/v1/accounts', 'GET', undefined, adminToken));
  const dataAccounts = await resAccounts.json();
  assert(resAccounts.status === 200 && dataAccounts.success, 'GET /api/v1/accounts returned all accounts with metrics');

  const allAccounts: any[] = dataAccounts.data;
  console.log(`  Total accounts evaluated in Chart of Accounts: ${allAccounts.length}`);

  let reconciledCount = 0;
  let unreconciledCount = 0;
  const currenciesFound = new Set<string>();

  for (const acc of allAccounts) {
    currenciesFound.add(acc.currency);

    // Verify calculatedLedgerBalance matches currentBalance within tolerance
    const diff = Math.abs(acc.calculatedLedgerBalance - acc.currentBalance);
    const isMatched = diff <= 0.01;

    if (isMatched && acc.isReconciled) {
      reconciledCount++;
    } else {
      unreconciledCount++;
      console.error(`  [MISMATCH] Account ${acc.accountCode} (${acc.name}): current=${acc.currentBalance}, ledgerCalc=${acc.calculatedLedgerBalance}`);
    }
  }

  assert(unreconciledCount === 0, `100% of accounts (${reconciledCount}/${allAccounts.length}) are fully reconciled with General Ledger`);
  assert(currenciesFound.has('EGP') && currenciesFound.has('SDG') && currenciesFound.has('USD'), 'Reconciliation covers all currencies (EGP, SDG, USD)');

  // Verify system accounts inclusion
  const systemCodes = ['1010', '1020', '1030', '1060', '1065', '2010', '2020', '3010', '4010', '5010'];
  for (const code of systemCodes) {
    const sysAcc = allAccounts.find(a => a.accountCode === code);
    if (sysAcc) {
      assert(sysAcc.isReconciled === true, `System core account ${code} (${sysAcc.name}) is fully reconciled`);
    }
  }

  // Verify inactive account reconciliation
  const inactiveAcc = allAccounts.find(a => a.status === 'inactive');
  if (inactiveAcc) {
    assert(inactiveAcc.isReconciled === true, `Inactive account ${inactiveAcc.accountCode} (${inactiveAcc.name}) is properly reconciled`);
  }

  console.log('\n========================================================================');
  console.log(`   AUDIT COMPLETE: ${passed} / ${total} CHECKS PASSED (100% SUCCESS)`);
  console.log('========================================================================\n');
}

runFinalAccountingIntegrityAudit()
  .catch((e) => {
    console.error('Audit failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
