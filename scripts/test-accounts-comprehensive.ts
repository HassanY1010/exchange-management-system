import { prisma } from '../lib/db';
import { GET as getAccounts, POST as createAccount } from '../app/api/v1/accounts/route';
import { GET as getAccountById, PATCH as updateAccount, DELETE as deleteAccount } from '../app/api/v1/accounts/[id]/route';
import { GET as getTransfers, POST as createTransfer } from '../app/api/v1/accounts/transfers/route';
import { NextRequest } from 'next/server';
import { generateToken } from '../lib/auth';
import Decimal from 'decimal.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] Test ${totalTests}: ${testName}`);
  } else {
    console.error(`  [FAIL] Test ${totalTests}: ${testName}`, details || '');
    throw new Error(`Assertion failed: ${testName}`);
  }
}

function createMockReq(url: string, method: string = 'GET', body?: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const init: any = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(url, init);
}

async function runAccountsComprehensiveSuite() {
  console.log('================================================================');
  console.log('   COMPREHENSIVE AUDIT & VERIFICATION SUITE: ACCOUNTS & SAFES');
  console.log('================================================================\n');

  const adminToken = generateToken({
    userId: 'admin-tester-id',
    email: 'admin@system.com',
    name: 'Admin Tester',
    role: 'admin',
  });

  const accountantToken = generateToken({
    userId: 'accountant-tester-id',
    email: 'accountant@system.com',
    name: 'Accountant Tester',
    role: 'accountant',
  });

  const cashierToken = generateToken({
    userId: 'cashier-tester-id',
    email: 'cashier@system.com',
    name: 'Cashier Tester',
    role: 'cashier',
  });

  const timestamp = Date.now();

  // 1. Create a new account with custom code and 0 opening balance
  console.log('--- Group 1: Account Creation & Validations ---');
  const code1 = `107${Math.floor(Math.random() * 90 + 10)}`;
  const reqCreate1 = createMockReq('http://localhost:3000/api/v1/accounts', 'POST', {
    name: `خزينة فرع اختبار ${timestamp}`,
    accountCode: code1,
    accountType: 'cash_safe',
    currency: 'EGP',
    openingBalance: 0,
    description: 'خزينة اختبار جديدة',
  }, adminToken);

  const resCreate1 = await createAccount(reqCreate1);
  const dataCreate1 = await resCreate1.json();
  assert(resCreate1.status === 201 && dataCreate1.success, 'New account created with status 201', dataCreate1);
  const acc1Id = dataCreate1.data.id;

  // 2. Prevent duplicate Account Code
  const reqDupCode = createMockReq('http://localhost:3000/api/v1/accounts', 'POST', {
    name: `خزينة كود مكرر ${timestamp}`,
    accountCode: code1,
    accountType: 'cash_safe',
    currency: 'EGP',
  }, adminToken);
  const resDupCode = await createAccount(reqDupCode);
  assert(resDupCode.status === 400, 'Duplicate account code rejected with 400 error');

  // 3. Create account in a different currency (USD)
  const codeUsd = `108${Math.floor(Math.random() * 90 + 10)}`;
  const reqCreateUsd = createMockReq('http://localhost:3000/api/v1/accounts', 'POST', {
    name: `خزينة دولار اختبار ${timestamp}`,
    accountCode: codeUsd,
    accountType: 'cash_safe',
    currency: 'USD',
    openingBalance: 0,
  }, adminToken);
  const resCreateUsd = await createAccount(reqCreateUsd);
  const dataCreateUsd = await resCreateUsd.json();
  assert(resCreateUsd.status === 201 && dataCreateUsd.data.currency === 'USD', 'USD currency safe created cleanly');
  const accUsdId = dataCreateUsd.data.id;

  // 4. Create account with opening balance > 0 (backed by balanced ledger entry)
  console.log('\n--- Group 2: Opening Balance Financial Integrity ---');
  const codeOpening = `109${Math.floor(Math.random() * 90 + 10)}`;
  const initialAmount = 250000;
  const reqCreateOpening = createMockReq('http://localhost:3000/api/v1/accounts', 'POST', {
    name: `خزينة برصيد افتتاحي ${timestamp}`,
    accountCode: codeOpening,
    accountType: 'cash_safe',
    currency: 'EGP',
    openingBalance: initialAmount,
  }, adminToken);
  const resCreateOpening = await createAccount(reqCreateOpening);
  const dataCreateOpening = await resCreateOpening.json();
  assert(resCreateOpening.status === 201, 'Account with opening balance created successfully');
  const accOpeningId = dataCreateOpening.data.id;

  // 5. Verify opening balance ledger entry was created and balances exactly
  const ledgerOpening = await prisma.ledgerEntry.findFirst({
    where: {
      referenceType: 'Account',
      referenceId: accOpeningId,
      entryType: 'opening_balance',
    },
    include: { lines: true },
  });
  assert(!!ledgerOpening, 'Opening balance double-entry ledger entry was automatically generated');
  const debitSum = ledgerOpening!.lines.reduce((s, l) => s + Number(l.debit), 0);
  const creditSum = ledgerOpening!.lines.reduce((s, l) => s + Number(l.credit), 0);
  assert(debitSum === creditSum && debitSum === initialAmount, 'Opening balance ledger lines balance perfectly (Debit == Credit == 250,000)');

  // Verify account currentBalance matches opening balance
  const checkAccOpening = await prisma.account.findUnique({ where: { id: accOpeningId } });
  assert(Number(checkAccOpening!.currentBalance) === initialAmount, 'Account currentBalance updated via ledger posting to 250,000');

  // 6. Update account (name and description)
  console.log('\n--- Group 3: Account Lifecycle, Update & Deletion Guard ---');
  const reqUpdate = createMockReq(`http://localhost:3000/api/v1/accounts/${acc1Id}`, 'PATCH', {
    name: `خزينة معدلة ${timestamp}`,
    description: 'تم تحديث الوصف بنجاح',
  }, accountantToken);
  const resUpdate = await updateAccount(reqUpdate, { params: { id: acc1Id } });
  const dataUpdate = await resUpdate.json();
  assert(resUpdate.status === 200 && dataUpdate.data.name.includes('معدلة'), 'Account updated successfully by Accountant');

  // 7. Deactivate account
  const reqDeactivate = createMockReq(`http://localhost:3000/api/v1/accounts/${acc1Id}`, 'PATCH', {
    status: 'inactive',
  }, adminToken);
  const resDeactivate = await updateAccount(reqDeactivate, { params: { id: acc1Id } });
  const dataDeactivate = await resDeactivate.json();
  assert(resDeactivate.status === 200 && dataDeactivate.data.status === 'inactive', 'Account status toggled to inactive');

  // 8. Block deleting account with financial history
  const reqDeleteHistory = createMockReq(`http://localhost:3000/api/v1/accounts/${accOpeningId}`, 'DELETE', undefined, adminToken);
  const resDeleteHistory = await deleteAccount(reqDeleteHistory, { params: { id: accOpeningId } });
  assert(resDeleteHistory.status === 400, 'Deleting account with ledger history is strictly blocked (400)');

  // 9. Block deleting system accounts (e.g. 1010 Main EGP Safe)
  const systemAcc1010 = await prisma.account.findFirst({ where: { accountCode: '1010' } });
  assert(!!systemAcc1010, 'System account 1010 confirmed');
  const reqDeleteSystem = createMockReq(`http://localhost:3000/api/v1/accounts/${systemAcc1010!.id}`, 'DELETE', undefined, adminToken);
  const resDeleteSystem = await deleteAccount(reqDeleteSystem, { params: { id: systemAcc1010!.id } });
  assert(resDeleteSystem.status === 400, 'Deleting system core account 1010 is strictly blocked');

  // Reactivate acc1 for transfer testing
  await prisma.account.update({ where: { id: acc1Id }, data: { status: 'active' } });

  // 10. Fund Transfers: Same-Currency Transfer
  console.log('\n--- Group 4: Fund Transfers & Atomic Double-Entry ---');
  // Transfer 50,000 EGP from accOpeningId (bal: 250k) to acc1Id (bal: 0)
  const reqTrfSame = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
    fromAccountId: accOpeningId,
    toAccountId: acc1Id,
    amount: 50000,
    description: 'تغذية نقدية من الخزينة الرئيسية إلى الخزينة الفرعية',
  }, adminToken);
  const resTrfSame = await createTransfer(reqTrfSame);
  const dataTrfSame = await resTrfSame.json();
  assert(resTrfSame.status === 200 && dataTrfSame.success, 'Same-currency transfer completed successfully (200)');

  // Verify updated balances
  const postFromAcc = await prisma.account.findUnique({ where: { id: accOpeningId } });
  const postToAcc = await prisma.account.findUnique({ where: { id: acc1Id } });
  assert(Number(postFromAcc!.currentBalance) === 200000, 'Source safe balance deducted by 50,000 (now 200,000)');
  assert(Number(postToAcc!.currentBalance) === 50000, 'Destination safe balance credited with 50,000 (now 50,000)');

  // 11. Verify Transfer record created in AccountTransfer
  const trfRecord = await prisma.accountTransfer.findUnique({
    where: { transferNumber: dataTrfSame.data.transferNumber },
  });
  assert(!!trfRecord && Number(trfRecord.amount) === 50000, 'Transfer record persisted in AccountTransfer table');

  // 12. Cross-Currency Transfer with Exchange Rate & Clearing Legs
  console.log('\n--- Group 5: Cross-Currency Transfer & Multi-Currency Routing ---');
  // Transfer 50,000 EGP to USD Safe at rate 0.02 (or 50 EGP per 1 USD -> 1,000 USD received)
  const reqTrfCross = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
    fromAccountId: acc1Id, // has 50,000 EGP
    toAccountId: accUsdId, // USD safe (has 0 USD)
    amount: 50000,
    toAmount: 1000,
    exchangeRate: 0.02,
    description: 'شراء وتغذية خزينة الدولار بمبلغ 1,000 USD مقابل 50,000 EGP',
  }, adminToken);
  const resTrfCross = await createTransfer(reqTrfCross);
  const dataTrfCross = await resTrfCross.json();
  assert(resTrfCross.status === 200 && dataTrfCross.success, 'Cross-currency transfer completed successfully (200)');

  const postCrossFrom = await prisma.account.findUnique({ where: { id: acc1Id } });
  const postCrossTo = await prisma.account.findUnique({ where: { id: accUsdId } });
  assert(Number(postCrossFrom!.currentBalance) === 0, 'Source EGP safe balance deducted by 50,000 (now 0)');
  assert(Number(postCrossTo!.currentBalance) === 1000, 'Destination USD safe balance credited with 1,000 USD');

  // 13. Safe Overdraft Protection (Insufficient funds)
  console.log('\n--- Group 6: Strict Transfer Constraints & Safeguards ---');
  // Attempt to transfer 100,000 EGP from acc1Id when balance is 0
  const reqOverdraft = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
    fromAccountId: acc1Id,
    toAccountId: accOpeningId,
    amount: 100000,
  }, adminToken);
  const resOverdraft = await createTransfer(reqOverdraft);
  assert(resOverdraft.status === 400 || resOverdraft.status === 500, 'Transfer exceeding available balance is strictly rejected');

  // 14. Reject non-positive amounts (negative or 0)
  const reqZero = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
    fromAccountId: accOpeningId,
    toAccountId: acc1Id,
    amount: 0,
  }, adminToken);
  const resZero = await createTransfer(reqZero);
  assert(resZero.status === 400, 'Zero amount transfer rejected with 400');

  const reqNeg = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
    fromAccountId: accOpeningId,
    toAccountId: acc1Id,
    amount: -500,
  }, adminToken);
  const resNeg = await createTransfer(reqNeg);
  assert(resNeg.status === 400, 'Negative amount transfer rejected with 400');

  // 15. Reject self-transfer
  const reqSelf = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
    fromAccountId: accOpeningId,
    toAccountId: accOpeningId,
    amount: 1000,
  }, adminToken);
  const resSelf = await createTransfer(reqSelf);
  assert(resSelf.status === 400, 'Self transfer rejected with 400');

  // 16. Reject transfers from/to inactive accounts
  await prisma.account.update({ where: { id: acc1Id }, data: { status: 'inactive' } });
  const reqInactive = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
    fromAccountId: acc1Id,
    toAccountId: accOpeningId,
    amount: 100,
  }, adminToken);
  const resInactive = await createTransfer(reqInactive);
  assert(resInactive.status === 400 || resInactive.status === 500, 'Transfer involving inactive account is rejected');
  await prisma.account.update({ where: { id: acc1Id }, data: { status: 'active' } });

  // 17. Concurrency & Race Condition Safety under Parallel Transfers
  console.log('\n--- Group 7: Concurrency & Row-Locking Test ---');
  // Current balance of accOpeningId is 200,000 EGP.
  // Two parallel requests try to transfer 150,000 EGP simultaneously.
  // Total attempted: 300,000 > 200,000. Exactly ONE must succeed and ONE must fail.
  let parallelSuccess = 0;
  let parallelFail = 0;

  const attemptParallelTransfer = async (id: number) => {
    const req = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
      fromAccountId: accOpeningId,
      toAccountId: acc1Id,
      amount: 150000,
      description: `تحويل تزامني رقم ${id}`,
    }, adminToken);
    const res = await createTransfer(req);
    const data = await res.json();
    if (res.status === 200 && data.success) {
      parallelSuccess++;
    } else {
      parallelFail++;
    }
  };

  await Promise.all([attemptParallelTransfer(1), attemptParallelTransfer(2)]);
  assert(parallelSuccess === 1, 'Exactly one concurrent transfer succeeded under row-level lock');
  assert(parallelFail === 1, 'Exactly one concurrent transfer failed due to insufficient funds');

  const finalBalOpening = await prisma.account.findUnique({ where: { id: accOpeningId } });
  assert(Number(finalBalOpening!.currentBalance) === 50000, 'Final balance of source safe is exactly 50,000 (never negative)');

  // 18. RBAC and Permissions Protection
  console.log('\n--- Group 8: RBAC & Permission Enforcement ---');
  // Unauthenticated request to /api/v1/accounts -> 401
  const reqUnauth = createMockReq('http://localhost:3000/api/v1/accounts');
  const resUnauth = await getAccounts(reqUnauth);
  assert(resUnauth.status === 401, 'Unauthenticated request to GET /api/v1/accounts returns 401');

  // Cashier attempting to create an account -> 403
  const reqCashierCreate = createMockReq('http://localhost:3000/api/v1/accounts', 'POST', {
    name: 'حساب كاشير مرفوض',
    accountType: 'cash_safe',
    currency: 'EGP',
  }, cashierToken);
  const resCashierCreate = await createAccount(reqCashierCreate);
  assert(resCashierCreate.status === 403, 'Cashier attempting to create an account is forbidden (403)');

  // Accountant attempting to delete an account -> 403 (Admin only)
  const reqAccountantDelete = createMockReq(`http://localhost:3000/api/v1/accounts/${acc1Id}`, 'DELETE', undefined, accountantToken);
  const resAccountantDelete = await deleteAccount(reqAccountantDelete, { params: { id: acc1Id } });
  assert(resAccountantDelete.status === 403, 'Non-admin attempting to delete an account is forbidden (403)');

  // 19. Reconciliation & Ledger Audit Check
  console.log('\n--- Group 9: General Ledger Reconciliation & Audit Integrity ---');
  const reqGetAudit = createMockReq('http://localhost:3000/api/v1/accounts', 'GET', undefined, adminToken);
  const resGetAudit = await getAccounts(reqGetAudit);
  const dataGetAudit = await resGetAudit.json();
  assert(resGetAudit.status === 200 && dataGetAudit.success, 'GET /api/v1/accounts returned audit metrics');

  // Verify all accounts with ledger lines are 100% reconciled
  const testAccs = dataGetAudit.data.filter((a: any) => [accOpeningId, acc1Id, accUsdId].includes(a.id));
  for (const acc of testAccs) {
    assert(acc.isReconciled === true, `Account ${acc.accountCode} (${acc.name}) is 100% reconciled with General Ledger`);
  }

  // 20. Clean Deletion of safe with 0 balance and 0 ledger lines
  console.log('\n--- Group 10: Clean Deletion of Empty Unused Account ---');
  const codeEmpty = `199${Math.floor(Math.random() * 90 + 10)}`;
  const reqCreateEmpty = createMockReq('http://localhost:3000/api/v1/accounts', 'POST', {
    name: `حساب فارغ للحذف ${timestamp}`,
    accountCode: codeEmpty,
    accountType: 'cash_safe',
    currency: 'EGP',
    openingBalance: 0,
  }, adminToken);
  const resCreateEmpty = await createAccount(reqCreateEmpty);
  const dataCreateEmpty = await resCreateEmpty.json();
  const emptyAccId = dataCreateEmpty.data.id;

  const reqDeleteClean = createMockReq(`http://localhost:3000/api/v1/accounts/${emptyAccId}`, 'DELETE', undefined, adminToken);
  const resDeleteClean = await deleteAccount(reqDeleteClean, { params: { id: emptyAccId } });
  assert(resDeleteClean.status === 200, 'Unused account with zero balance deleted cleanly');

  console.log('\n================================================================');
  console.log(`   ALL TESTS COMPLETED: ${passedTests} / ${totalTests} PASSED (100%)`);
  console.log('================================================================\n');
}

runAccountsComprehensiveSuite()
  .catch((e) => {
    console.error('Test suite failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
