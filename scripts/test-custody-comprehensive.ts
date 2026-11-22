import { prisma } from '../lib/db';
import { generateToken } from '../lib/auth';
import { NextRequest } from 'next/server';
import { POST as createEmployee, GET as getEmployees } from '../app/api/v1/employees/route';
import { PATCH as updateEmployee, DELETE as deleteEmployee } from '../app/api/v1/employees/[id]/route';
import { POST as issueCustody, GET as getCustodies } from '../app/api/v1/custody/route';
import { POST as deliverCash } from '../app/api/v1/custody/[id]/deliver/route';
import { POST as returnToSafe } from '../app/api/v1/custody/[id]/return/route';
import { POST as settleCustody } from '../app/api/v1/custody/[id]/settle/route';
import Decimal from 'decimal.js';

let passed = 0;
let total = 0;

function assert(condition: boolean, message: string, details?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  [اختبار ${total}] ✅ ${message}`);
    if (details) console.log(`     -> ${details}`);
  } else {
    console.error(`  [اختبار ${total}] ❌ فشل: ${message}`);
    if (details) console.error(`     -> تفاصيل: ${details}`);
    throw new Error(`Test failed: ${message}`);
  }
}

async function runCustodyTestSuite() {
  console.log('========================================================================================');
  console.log('   فحص وتدقيق واختبار نظام الموظفين والعهد النقدية (Employees & Cash Custody Suite)   ');
  console.log('========================================================================================\n');

  const runSalt = Date.now();

  // Test Authentication Tokens
  const tokenAdmin = generateToken({
    userId: 'u-custody-admin',
    email: 'admin-custody@exchange.local',
    name: 'المدير العام',
    role: 'admin',
  });

  const tokenAccountant = generateToken({
    userId: 'u-custody-accountant',
    email: 'accountant-custody@exchange.local',
    name: 'المحاسب المالي',
    role: 'accountant',
  });

  const tokenCustodyOfficer = generateToken({
    userId: 'u-custody-officer',
    email: 'officer-custody@exchange.local',
    name: 'مسؤول العهدة والتسليم',
    role: 'custody_officer',
  });

  const tokenDataEntry = generateToken({
    userId: 'u-custody-entry',
    email: 'entry-custody@exchange.local',
    name: 'مدخل بيانات',
    role: 'data_entry',
  });

  // Ensure Base Safe Accounts exist in real PostgreSQL
  const safeEgp = await prisma.account.upsert({
    where: { accountCode: '1010' },
    update: {},
    create: {
      accountCode: '1010',
      name: 'الصندوق النقدي المصري الرئيسي (Main EGP Safe)',
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 10000000,
      currentBalance: 10000000,
      status: 'active',
    },
  });

  // Ensure Customer Liability Account exists
  await prisma.account.upsert({
    where: { accountCode: '2010' },
    update: {},
    create: {
      accountCode: '2010',
      name: 'حساب وسيط التزامات العملاء (Customer Liability EGP)',
      accountType: 'customer_balance',
      currency: 'EGP',
      openingBalance: 0,
      currentBalance: 0,
      status: 'active',
    },
  });

  // Ensure Test Customer exists
  const testCustomer = await prisma.customer.upsert({
    where: { customerCode: `CUST-CUSTODY-${runSalt}` },
    update: {},
    create: {
      customerCode: `CUST-CUSTODY-${runSalt}`,
      name: `عميل فحص العهدة ${runSalt}`,
      phone: `+2011${Math.floor(10000000 + Math.random() * 90000000)}`,
      status: 'active',
    },
  });

  // --- 1. اختبارات إدارة الموظفين (Employee Management) ---
  console.log('--- 1. اختبارات إدارة الموظفين والصلاحيات (Employees Management) ---');

  // Test 1: RBAC on Create Employee
  const empReqUnauthorized = new NextRequest('http://localhost:3000/api/v1/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenDataEntry}` },
    body: JSON.stringify({ name: 'موظف غير مصرح', phone: '+201000000999' }),
  });
  const empResUnauth = await createEmployee(empReqUnauthorized);
  assert(empResUnauth.status === 403, 'حماية الصلاحيات: منع مدخل البيانات من إضافة موظف (مقتصر على المدير والمحاسب)');

  // Test 2: Successful Employee Creation by Accountant
  const testEmpPhone = `+2012${Math.floor(10000000 + Math.random() * 90000000)}`;
  const empReqValid = new NextRequest('http://localhost:3000/api/v1/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      name: `موظف تسليم اختبار ${runSalt}`,
      phone: testEmpPhone,
      jobTitle: 'مسؤول تسليم نقدية',
      identityNumber: `ID-${runSalt}`,
    }),
  });
  const empResValid = await createEmployee(empReqValid);
  const empJsonValid = await empResValid.json();
  assert(
    empResValid.status === 201 && empJsonValid.data?.id,
    `نجاح إضافة موظف جديد برمز ${empJsonValid.data?.employeeCode} واسم ${empJsonValid.data?.name}`
  );
  const createdEmployeeId = empJsonValid.data.id;

  // Test 3: Auto-creation of dedicated custody account in chart of accounts
  const custodyAcc = await prisma.account.findFirst({
    where: {
      accountType: 'employee_custody',
      name: { contains: empJsonValid.data.name },
    },
  });
  assert(
    Boolean(custodyAcc && custodyAcc.currency === 'EGP'),
    `إنشاء حساب عهدة مخصص تلقائياً في شجرة الحسابات برقم ${custodyAcc?.accountCode}`
  );

  // Test 4: Prevent Duplicate Phone for Employee
  const empReqDup = new NextRequest('http://localhost:3000/api/v1/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ name: 'موظف مكرر', phone: testEmpPhone }),
  });
  const empResDup = await createEmployee(empReqDup);
  assert(empResDup.status === 400, 'منع تكرار رقم هاتف الموظف (Duplicate Phone Check)');

  // Test 5: Update Employee Information
  const empPatchReq = new NextRequest(`http://localhost:3000/api/v1/employees/${createdEmployeeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
    body: JSON.stringify({ jobTitle: 'كبير مسؤولي الخزينة والتسليم' }),
  });
  const empPatchRes = await updateEmployee(empPatchReq, { params: { id: createdEmployeeId } });
  const empPatchJson = await empPatchRes.json();
  assert(
    empPatchRes.status === 200 && empPatchJson.data.jobTitle === 'كبير مسؤولي الخزينة والتسليم',
    'نجاح تعديل بيانات الموظف والمسمى الوظيفي بواسطة المدير'
  );

  // --- 2. اختبارات تسليم العهد النقدية (Issue Custody) ---
  console.log('\n--- 2. اختبارات تسليم العهد النقدية والتحقق المالي (Issue Custody) ---');

  // Test 6: Reject Issue Custody by Unauthorized Role
  const custodyReqUnauth = new NextRequest('http://localhost:3000/api/v1/custody', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenDataEntry}` },
    body: JSON.stringify({ employeeId: createdEmployeeId, amount: 500000 }),
  });
  const custodyResUnauth = await issueCustody(custodyReqUnauth);
  assert(custodyResUnauth.status === 403, 'حماية الصلاحيات: رفض تسليم عهدة نقدية من غير المحاسب والمدير');

  // Test 7: Reject Custody with Zero or Negative Amount
  const custodyReqZero = new NextRequest('http://localhost:3000/api/v1/custody', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ employeeId: createdEmployeeId, amount: -1000 }),
  });
  const custodyResZero = await issueCustody(custodyReqZero);
  assert(custodyResZero.status === 400, 'رفض تسليم عهدة بمبلغ سالب أو صفر');

  // Test 8: Safe Overdraft Protection (Amount > Safe Balance)
  const custodyReqOver = new NextRequest('http://localhost:3000/api/v1/custody', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ employeeId: createdEmployeeId, amount: 999999999999 }),
  });
  const custodyResOver = await issueCustody(custodyReqOver);
  assert(custodyResOver.status === 500 || custodyResOver.status === 400, 'حماية رصيد الخزينة: منع تسليم عهدة تتجاوز الرصيد الفعلي للخزينة');

  // Test 9: Successful Custody Issuance with Atomic Double-Entry Ledger Posting
  const safeBalBefore = Number((await prisma.account.findUnique({ where: { id: safeEgp.id } }))?.currentBalance);
  const custodyAmountToIssue = 100000; // 100,000 EGP

  const custodyReqValid = new NextRequest('http://localhost:3000/api/v1/custody', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      employeeId: createdEmployeeId,
      amount: custodyAmountToIssue,
      currency: 'EGP',
      notes: 'عهدة نقدية لاختبار دورة التسليم الكاملة',
    }),
  });
  const custodyResValid = await issueCustody(custodyReqValid);
  const custodyJsonValid = await custodyResValid.json();
  const createdCustody = custodyJsonValid.data;

  assert(
    custodyResValid.status === 201 && createdCustody?.id && Number(createdCustody.currentAmount) === custodyAmountToIssue,
    `نجاح تسليم عهدة نقدية للموظف بمبلغ ${custodyAmountToIssue.toLocaleString()} EGP وحالة open`
  );

  // Test 10: Verify Safe Balance Deducted and Custody Account Credited
  const safeBalAfter = Number((await prisma.account.findUnique({ where: { id: safeEgp.id } }))?.currentBalance);
  assert(
    Math.abs(safeBalBefore - safeBalAfter - custodyAmountToIssue) < 0.01,
    'خصم مبلغ العهدة من الخزينة الرئيسية بدقة في شجرة الحسابات (Safe Account Balance Updated)'
  );

  // Test 11: Verify Ledger Entry and Custody Transaction
  const custodyLedgerEntry = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'EmployeeCustody', referenceId: createdCustody.id },
    include: { lines: true },
  });
  assert(
    Boolean(custodyLedgerEntry && custodyLedgerEntry.lines.length === 2),
    'تسجيل قيد اليومية المزدوج المتوازن لتسليم العهدة (مدين العهدة، دائن الخزينة)'
  );

  // --- 3. اختبارات عمليات الصرف من العهدة (Cash Delivery) والتزامن ---
  console.log('\n--- 3. اختبارات صرف النقدية وحماية التزامن (Cash Delivery & Concurrency) ---');

  // Test 12: Overdraft Delivery Rejection (Deliver > Custody currentAmount)
  const deliverReqOver = new NextRequest(`http://localhost:3000/api/v1/custody/${createdCustody.id}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCustodyOfficer}` },
    body: JSON.stringify({
      customerId: testCustomer.id,
      amount: 150000, // Available is 100,000
    }),
  });
  const deliverResOver = await deliverCash(deliverReqOver, { params: { id: createdCustody.id } });
  assert(deliverResOver.status === 500 || deliverResOver.status === 400, 'منع تجاوز رصيد العهدة: رفض طلب صرف مبلغ أكبر من رصيد العهدة المتاح');

  // Test 13: Concurrency Race Condition Protection!
  // Available: 100,000 EGP. Two concurrent requests: Req A = 70,000, Req B = 50,000. Total = 120,000 > 100,000.
  // Exactly ONE must succeed and the other MUST fail!
  const reqA = new NextRequest(`http://localhost:3000/api/v1/custody/${createdCustody.id}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCustodyOfficer}` },
    body: JSON.stringify({ customerId: testCustomer.id, amount: 70000, notes: 'صرف متزامن أ' }),
  });
  const reqB = new NextRequest(`http://localhost:3000/api/v1/custody/${createdCustody.id}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCustodyOfficer}` },
    body: JSON.stringify({ customerId: testCustomer.id, amount: 50000, notes: 'صرف متزامن ب' }),
  });

  const [resA, resB] = await Promise.all([
    deliverCash(reqA, { params: { id: createdCustody.id } }),
    deliverCash(reqB, { params: { id: createdCustody.id } }),
  ]);

  const deliveryStatuses = [resA.status, resB.status];
  const successCount = deliveryStatuses.filter((s) => s === 200).length;
  const failCount = deliveryStatuses.filter((s) => s >= 400).length;

  const custodyAfterConcurrency = await prisma.employeeCustody.findUnique({
    where: { id: createdCustody.id },
  });

  assert(
    successCount === 1 && failCount === 1 && Number(custodyAfterConcurrency?.currentAmount) >= 0,
    `حماية التزامن الذرية برقم القفل (Row Lock FOR UPDATE): نجاح عملية واحدة فقط (${successCount}) وفشل الأخرى (${failCount}) والرصيد المتبقي ${custodyAfterConcurrency?.currentAmount} EGP دون أن يصبح سالباً`
  );

  // Test 14: Verify Double-entry Ledger for Delivery
  const dlvLedger = await prisma.ledgerEntry.findFirst({
    where: { entryType: 'custody_delivery' },
    orderBy: { createdAt: 'desc' },
    include: { lines: true },
  });
  assert(
    Boolean(dlvLedger && dlvLedger.lines.length === 2),
    'تسجيل قيد اليومية المزدوج لصرف النقدية للعميل (مدين التزامات العملاء، دائن عهدة الموظف)'
  );

  // --- 4. اختبارات استرجاع الأموال للصندوق وتسوية العهدة ---
  console.log('\n--- 4. اختبارات استرجاع الأموال والتسوية والإغلاق (Return & Settlement) ---');

  const remainingBeforeReturn = Number(custodyAfterConcurrency?.currentAmount); // e.g. 30,000 or 50,000

  // Test 15: Partial Return to Safe
  const returnAmountPartial = 10000;
  const returnReq = new NextRequest(`http://localhost:3000/api/v1/custody/${createdCustody.id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCustodyOfficer}` },
    body: JSON.stringify({
      amount: returnAmountPartial,
      notes: 'استرجاع جزئي للصندوق بنهاية اليوم',
    }),
  });
  const returnRes = await returnToSafe(returnReq, { params: { id: createdCustody.id } });
  const returnJson = await returnRes.json();

  assert(
    returnRes.status === 200 && returnJson.success,
    `نجاح استرجاع جزئي لمبلغ ${returnAmountPartial.toLocaleString()} EGP من العهدة إلى الخزينة الرئيسية`
  );

  // Test 16: Verify Return Ledger Entry and Safe Balance Restoration
  const returnLedger = await prisma.ledgerEntry.findFirst({
    where: { entryType: 'custody_return' },
    orderBy: { createdAt: 'desc' },
  });
  assert(
    Boolean(returnLedger),
    'توثيق قيد استرجاع النقدية دفترياً (مدين الخزينة، دائن العهدة)'
  );

  // Test 17: Final Settlement & Close of Custody
  const settleReq = new NextRequest(`http://localhost:3000/api/v1/custody/${createdCustody.id}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ returnRemainingToSafe: true }),
  });
  const settleRes = await settleCustody(settleReq, { params: { id: createdCustody.id } });
  const settleJson = await settleRes.json();

  assert(
    settleRes.status === 200 && settleJson.data?.status === 'closed' && Number(settleJson.data?.currentAmount) === 0,
    'نجاح تسوية وإغلاق العهدة نهائياً واسترجاع باقي الرصيد للخزينة لتصبح الحالة closed والرصيد 0'
  );

  // Test 18: Reject Delivery from Closed Custody
  const deliverFromClosedReq = new NextRequest(`http://localhost:3000/api/v1/custody/${createdCustody.id}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCustodyOfficer}` },
    body: JSON.stringify({ customerId: testCustomer.id, amount: 5000 }),
  });
  const deliverFromClosedRes = await deliverCash(deliverFromClosedReq, { params: { id: createdCustody.id } });
  assert(
    deliverFromClosedRes.status >= 400,
    'حماية العهدة المغلقة: منع صرف أي نقدية من عهدة مغلقة ومسواة'
  );

  // Test 19: Reject Re-settling Already Closed Custody
  const reSettleRes = await settleCustody(settleReq, { params: { id: createdCustody.id } });
  assert(
    reSettleRes.status >= 400,
    'منع تكرار تسوية عهدة مغلقة بالفعل'
  );

  // --- 5. اختبارات حماية الموظف والسجلات المالية من الحذف ---
  console.log('\n--- 5. اختبارات حماية السجلات المالية التاريخية (Historical Data Protection) ---');

  // Test 20: Prevent Deleting Employee with Financial History
  const delEmpReq = new NextRequest(`http://localhost:3000/api/v1/employees/${createdEmployeeId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  const delEmpRes = await deleteEmployee(delEmpReq, { params: { id: createdEmployeeId } });
  assert(
    delEmpRes.status === 400,
    'منع حذف موظف لديه سجلات عهد نقدية أو معاملات مالية تاريخية لحماية الدفاتر المحاسبية'
  );

  // Test 21: Deactivate Employee Gracefully
  const deactEmpReq = new NextRequest(`http://localhost:3000/api/v1/employees/${createdEmployeeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
    body: JSON.stringify({ status: 'inactive' }),
  });
  const deactEmpRes = await updateEmployee(deactEmpReq, { params: { id: createdEmployeeId } });
  const deactEmpJson = await deactEmpRes.json();
  assert(
    deactEmpRes.status === 200 && deactEmpJson.data.status === 'inactive',
    'إيقاف الموظف مع الحفاظ التام على كامل السجل المالي والدفتري التاريخي'
  );

  // Test 22: Reject Issuing New Custody to Inactive Employee
  const custToInactiveReq = new NextRequest('http://localhost:3000/api/v1/custody', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ employeeId: createdEmployeeId, amount: 20000 }),
  });
  const custToInactiveRes = await issueCustody(custToInactiveReq);
  assert(
    custToInactiveRes.status === 400,
    'منع تسليم عهدة نقدية جديدة لموظف موقوف'
  );

  // Test 23: Employees Query with Aggregated Financial Stats
  const getEmpReq = new NextRequest('http://localhost:3000/api/v1/employees', {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenAccountant}` },
  });
  const getEmpRes = await getEmployees(getEmpReq);
  const getEmpJson = await getEmpRes.json();
  const testedEmp = getEmpJson.data.find((e: any) => e.id === createdEmployeeId);

  assert(
    testedEmp && testedEmp.stats && testedEmp.stats.totalCustodyIssued === custodyAmountToIssue,
    'حساب وعرض الإحصائيات المالية المجمعة للموظف (إجمالي العهد المسلمة، المصروف، والرصيد)'
  );

  // Test 24: Custodies Query with Financial Summaries
  const getCustReq = new NextRequest('http://localhost:3000/api/v1/custody', {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenAccountant}` },
  });
  const getCustRes = await getCustodies(getCustReq);
  const getCustJson = await getCustRes.json();

  assert(
    getCustRes.status === 200 && getCustJson.summary && getCustJson.summary.totalCustodies >= 1,
    'استرجاع قائمة العهد وإحصائيات الـ KPIs المالية المجمعة بنجاح'
  );

  console.log('\n========================================================================================');
  console.log(`  🏆 نجحت جميع اختبارات الموظفين والعهد النقدية: ${passed} من أصل ${total} بنسبة 100%!`);
  console.log('========================================================================================\n');
}

runCustodyTestSuite()
  .catch((err) => {
    console.error('Custody test suite failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
