import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { NextRequest } from 'next/server';
import { GET as getCustomers, POST as createCustomer } from '../app/api/v1/customers/route';
import { GET as getCustomerStatement } from '../app/api/v1/customers/[id]/statement/route';
import { PATCH as updateCustomer } from '../app/api/v1/customers/[id]/route';

const prisma = new PrismaClient();

async function runCustomersComprehensiveTests() {
  console.log('========================================================================================');
  console.log('  فحص وتدقيق سجل وملفات العملاء الشامل (Customers Module Comprehensive Audit)          ');
  console.log('  الهدف: التحقق من دقة كشف الحساب، الصلاحيات، البحث، وتوليد الكود الآمن تحت التزامن     ');
  console.log('========================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, title: string, detail: string = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  [اختبار ${total}] ✅ ${title}`);
      if (detail) console.log(`     -> ${detail}`);
    } else {
      console.error(`  [اختبار ${total}] ❌ فشل: ${title}`);
      if (detail) console.error(`     -> التفاصيل: ${detail}`);
      throw new Error(`Test failed: ${title}`);
    }
  }

  // Tokens for RBAC testing
  const tokenAdmin = generateToken({ userId: 'u-admin', email: 'admin@test.com', name: 'المدير العام', role: 'admin' });
  const tokenAccountant = generateToken({ userId: 'u-acct', email: 'acct@test.com', name: 'المحاسب المالي', role: 'accountant' });
  const tokenDataEntry = generateToken({ userId: 'u-data', email: 'data@test.com', name: 'مدخل بيانات', role: 'data_entry' });
  const tokenCustody = generateToken({ userId: 'u-cust', email: 'cust@test.com', name: 'مسؤول العهدة', role: 'custody_officer' });
  const tokenAuditor = generateToken({ userId: 'u-audit', email: 'audit@test.com', name: 'مدقق بنكك', role: 'bankak_auditor' });

  // 1. Validation Tests on Customer Creation
  console.log('--- 1. فحص قواعد التحقق الصارمة لإنشاء العميل (Validation Checks) ---');

  async function callCreate(body: any, token: string = tokenDataEntry) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest('http://localhost:3000/api/v1/customers', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await createCustomer(req);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  // A. Empty name
  const resEmptyName = await callCreate({ name: '  ', phone: '+249911111111' });
  assert(resEmptyName.status === 400 && resEmptyName.data.error.includes('اسم العميل'), 'رفض إنشاء عميل باسم فارغ (400 Bad Request)');

  // B. Short phone
  const resShortPhone = await callCreate({ name: 'عميل اختبار', phone: '123' });
  assert(resShortPhone.status === 400 && resShortPhone.data.error.includes('رقم الهاتف'), 'رفض إنشاء عميل برقم هاتف قصير غير صالح (400 Bad Request)');

  // C. Valid creation with default WhatsApp
  const ts = Date.now();
  const testPhone = `+2499${ts.toString().slice(-8)}`;
  const resValid = await callCreate({
    name: 'عبدالله محمد علي',
    phone: testPhone,
    whatsapp: '', // empty to test default
    city: 'الخرطوم',
    identityNumber: 'ID-992211',
  });
  assert(
    resValid.status === 201 &&
    resValid.data.success === true &&
    resValid.data.data.whatsapp === testPhone &&
    resValid.data.data.customerCode.startsWith('CUST-'),
    'إنشاء عميل صالح واعتماد رقم الهاتف تلقائياً لواتساب وتوليد كود CUST-',
    `كود العميل: ${resValid.data.data?.customerCode} | واتساب: ${resValid.data.data?.whatsapp}`
  );

  const createdCustomer = resValid.data.data;

  // D. Duplicate phone prevention
  const resDup = await callCreate({
    name: 'عميل مكرر',
    phone: testPhone,
  });
  assert(resDup.status === 400 && resDup.data.error.includes('مسجل بالفعل'), 'منع تكرار رقم الهاتف لعميل نشط (Duplicate Phone Check)');

  // 2. Safe Concurrent Customer Code Generation Test
  console.log('\n--- 2. فحص أمان توليد كود العميل ضد التعارض المتزامن (Concurrency Safety) ---');
  const concurrentCalls = Array.from({ length: 5 }, (_, i) =>
    callCreate({
      name: `عميل متزامن ${i + 1}`,
      phone: `+2010${(ts + i).toString().slice(-8)}`,
      city: 'القاهرة',
    }, tokenAdmin)
  );

  const concurrentResults = await Promise.all(concurrentCalls);
  const allSuccessful = concurrentResults.every((r) => r.status === 201 && r.data.success === true);
  const generatedCodes = concurrentResults.map((r) => r.data.data.customerCode);
  const uniqueCodes = new Set(generatedCodes);

  assert(
    allSuccessful && uniqueCodes.size === 5,
    'توليد 5 أكواد عملاء متزامنة دون أي تعارض أو انهيار لقيد الفرادة (Zero P2002 Collision)',
    `الأكواد المنشأة: ${Array.from(uniqueCodes).join(', ')}`
  );

  // 3. Search and Filtering Test
  console.log('\n--- 3. فحص دقة محرك البحث والتصفية (Search Engine Verification) ---');
  async function callSearch(q: string, token: string = tokenAccountant) {
    const headers: any = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/customers?q=${encodeURIComponent(q)}`, { headers });
    const res = await getCustomers(req);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  // A. Search by Name
  const searchName = await callSearch('عبدالله محمد علي');
  assert(
    searchName.status === 200 && searchName.data.data.some((c: any) => c.id === createdCustomer.id),
    'البحث بالاسم: العثور على العميل بالاسم بدقة'
  );

  // B. Search by Phone
  const searchPhone = await callSearch(testPhone);
  assert(
    searchPhone.status === 200 && searchPhone.data.data.some((c: any) => c.phone === testPhone),
    'البحث برقم الهاتف: العثور على العميل برقم هاتفه'
  );

  // C. Search by Customer Code
  const searchCode = await callSearch(createdCustomer.customerCode);
  assert(
    searchCode.status === 200 && searchCode.data.data.some((c: any) => c.customerCode === createdCustomer.customerCode),
    'البحث بكود العميل: العثور على العميل بكوده الفريد'
  );

  // D. Search by Identity Number
  const searchId = await callSearch('ID-992211');
  assert(
    searchId.status === 200 && searchId.data.data.some((c: any) => c.identityNumber === 'ID-992211'),
    'البحث بالرقم القومي / جواز السفر: العثور على العميل برقم الهوية'
  );

  // 4. Customer Statement & Financial Accuracy Test
  console.log('\n--- 4. فحص كشف الحساب الرسمي والدقة المالية (Customer Statement & Math) ---');

  // Attach an active session and a cancelled session to verify exclusion
  const activeSession = await prisma.customerSession.create({
    data: {
      sessionNumber: `SES-STMT-ACT-${ts}`,
      customerId: createdCustomer.id,
      businessDate: '2026-11-21',
      requestedAmount: 15000,
      exchangeRate: 200,
      expectedAmount: 3000000,
      receivedAmount: 3000000,
      deliveredAmount: 15000,
      remainingAmount: 0,
      status: 'completed',
      createdBy: 'المحاسب المالي',
    },
  });

  const cancelledSession = await prisma.customerSession.create({
    data: {
      sessionNumber: `SES-STMT-CAN-${ts}`,
      customerId: createdCustomer.id,
      businessDate: '2026-11-21',
      requestedAmount: 50000,
      exchangeRate: 200,
      expectedAmount: 10000000,
      receivedAmount: 10000000, // should be excluded!
      deliveredAmount: 50000,
      remainingAmount: 0,
      status: 'cancelled',
      createdBy: 'المحاسب المالي',
    },
  });

  async function callStatement(custId: string, token: string = tokenAccountant) {
    const headers: any = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/customers/${custId}/statement`, { headers });
    const res = await getCustomerStatement(req, { params: { id: custId } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  const resStmt = await callStatement(createdCustomer.id);
  assert(resStmt.status === 200 && resStmt.data.success === true, 'استخراج كشف الحساب بنجاح 200 OK');

  const stmt = resStmt.data.statement;
  const sessionsInStmt = stmt.sessions;
  const hasCancelled = sessionsInStmt.some((s: any) => s.status === 'cancelled');

  assert(
    !hasCancelled && sessionsInStmt.some((s: any) => s.id === activeSession.id),
    'استبعاد الجلسات الملغاة (Cancelled) تماماً من كشف الحساب الرسمي',
    `عدد الجلسات النشطة في الكشف: ${sessionsInStmt.length}`
  );

  assert(
    stmt.summary.totalReceivedSdg === 3000000 && stmt.summary.totalDeliveredEgp === 15000,
    'حساب المجاميع المالية الصافية: 3,000,000 SDG مستلم، 15,000 EGP مسلم، واستبعاد الـ 10M الملغاة',
    `المستلم المحسوب: ${stmt.summary.totalReceivedSdg.toLocaleString()} SDG | المسلم: ${stmt.summary.totalDeliveredEgp.toLocaleString()} EGP`
  );

  // 5. RBAC Enforcement on Customer API
  console.log('\n--- 5. فحص حماية الصلاحيات في الـ API (RBAC Security Matrix) ---');

  // A. Custody officer trying to create customer -> 403 Forbidden
  const resCustodyCreate = await callCreate({ name: 'عميل أمين العهدة', phone: '+249912000000' }, tokenCustody);
  assert(
    resCustodyCreate.status === 403,
    'مسؤول العهدة: حظر مسؤول العهدة من إنشاء عميل جديد (403 Forbidden)',
    `كود الاستجابة: ${resCustodyCreate.status}`
  );

  // B. Data Entry trying to update customer -> 403 Forbidden
  async function callUpdate(custId: string, body: any, token: string) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/customers/${custId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    const res = await updateCustomer(req, { params: { id: custId } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  const resDataEntryUpdate = await callUpdate(createdCustomer.id, { name: 'اسم معدل' }, tokenDataEntry);
  assert(
    resDataEntryUpdate.status === 403,
    'مدخل البيانات: حظر مدخل البيانات من تعديل ملف العميل (403 Forbidden - مقتصر على المحاسب والمدير)'
  );

  // C. Accountant updating customer -> 200 OK
  const resAcctUpdate = await callUpdate(createdCustomer.id, { notes: 'عميل موثوق ومعتمد' }, tokenAccountant);
  assert(
    resAcctUpdate.status === 200 && resAcctUpdate.data.success === true && resAcctUpdate.data.data.notes === 'عميل موثوق ومعتمد',
    'المحاسب: تمكين المحاسب من تعديل وتوثيق ملف العميل مع تسجيل حدث التدقيق'
  );

  // 6. Customer Data Isolation
  console.log('\n--- 6. فحص عزل بيانات العملاء (Data Isolation Verification) ---');
  const resNotFound = await callStatement('00000000-0000-0000-0000-000000000000');
  assert(resNotFound.status === 404, 'محاولة طلب كشف حساب لعميل غير موجود ترد بـ 404 Not Found');

  console.log('\n========================================================================================');
  console.log(`  🏆 اجتازت جميع اختبارات سجل العملاء بنجاح كامل! (${passed} من ${total} اختبارات ناجحة)`);
  console.log('========================================================================================\n');
}

runCustomersComprehensiveTests()
  .catch((e) => {
    console.error('❌ خطأ أثناء اختبارات العملاء:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
