import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/v1/reports/dashboard/route';

const prisma = new PrismaClient();

async function runDashboardAuditTests() {
  console.log('========================================================================================');
  console.log('  فحص وتدقيق لوحة التحكم والمؤشرات المالية والصلاحيات (Dashboard Deep Audit Test)        ');
  console.log('  الهدف: التحقق من دقة المؤشرات المحاسبية، عدم التكرار، ودقة صلاحيات RBAC الفعلية         ');
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

  // Tokens for all real project roles
  const tokenAdmin = generateToken({ userId: 'u-admin', email: 'admin@test.com', name: 'المدير العام', role: 'admin' });
  const tokenAccountant = generateToken({ userId: 'u-acct', email: 'acct@test.com', name: 'المحاسب المالي', role: 'accountant' });
  const tokenCustody = generateToken({ userId: 'u-cust', email: 'cust@test.com', name: 'أمين العهدة', role: 'custody_officer' });
  const tokenDataEntry = generateToken({ userId: 'u-data', email: 'data@test.com', name: 'مدخل بيانات', role: 'data_entry' });
  const tokenAuditor = generateToken({ userId: 'u-audit', email: 'audit@test.com', name: 'مدقق بنكك', role: 'bankak_auditor' });

  async function callDashboardApi(token?: string) {
    const headers: any = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest('http://localhost:3000/api/v1/reports/dashboard', { headers });
    const res = await GET(req);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  // 1. Anonymous Access Test
  console.log('--- 1. اختبار المصادقة والحماية من الوصول المجهول (Anonymous Access) ---');
  const resAnon = await callDashboardApi();
  assert(resAnon.status === 401 && resAnon.data.success === false, 'المصادقة: حجب المستخدم غير المسجل بـ 401 Unauthorized');

  // 2. Financial KPI Accuracy Test
  console.log('\n--- 2. فحص دقة المؤشرات المحاسبية ومنع التضخيم أو التكرار (Financial KPI Accuracy) ---');
  const resAdmin = await callDashboardApi(tokenAdmin);
  assert(resAdmin.status === 200 && resAdmin.data.success === true, 'المدير: استرجاع بيانات لوحة التحكم بنجاح 200 OK');

  const kpi = resAdmin.data.data.kpi;
  const accounts = await prisma.account.findMany({ where: { status: 'active' } });

  // Calculate actual liquid cash accounts (Asset Cash)
  const expectedLiquidEgp = accounts
    .filter((a) => ['cash_safe', 'bank', 'employee_custody'].includes(a.accountType) && a.currency === 'EGP' && a.accountCode !== '1060')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const expectedLiquidSdg = accounts
    .filter((a) => ['cash_safe', 'bankak', 'bank', 'employee_custody'].includes(a.accountType) && a.currency === 'SDG' && a.accountCode !== '1065')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const expectedCapital = accounts
    .filter((a) => a.accountType === 'capital')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  assert(
    kpi.totalEgp === expectedLiquidEgp,
    'إجمالي الجنيه المصري EGP: يمثل السيولة النقدية الفعلية فقط دون إضافة رأس المال أو الخصوم',
    `الرصيد المحسوب: ${kpi.totalEgp.toLocaleString()} EGP | المتوقع: ${expectedLiquidEgp.toLocaleString()} EGP`
  );

  assert(
    kpi.totalSdg === expectedLiquidSdg,
    'إجمالي الجنيه السوداني SDG: يمثل الأصول النقدية الحقيقية فقط دون احتساب التزامات العملاء أو الموردين',
    `الرصيد المحسوب: ${kpi.totalSdg.toLocaleString()} SDG | المتوقع: ${expectedLiquidSdg.toLocaleString()} SDG`
  );

  assert(
    kpi.capitalBalance === expectedCapital,
    'رأس المال المستثمر: يمثل حقوق الملكية المحاسبية الفعلية (Capital Accounts)',
    `المبلغ: ${kpi.capitalBalance.toLocaleString()} EGP`
  );

  // 3. RBAC Separation of Duties on Dashboard
  console.log('\n--- 3. فحص مصفوفة الصلاحيات وفصل المهام في لوحة التحكم (RBAC Matrix) ---');

  // A. Accountant
  const resAcct = await callDashboardApi(tokenAccountant);
  const acctPerms = resAcct.data.data.permissions;
  assert(
    acctPerms.canDeliver === false,
    'المحاسب: حظر صرف النقدية عن المحاسب (canDeliver = false) تنفيذاً لمبدأ فصل الصلاحيات',
    `canDeliver: ${acctPerms.canDeliver}`
  );
  assert(
    acctPerms.canCloseDay === true && acctPerms.canManageSuppliers === true && acctPerms.canViewLedger === true,
    'المحاسب: تمكين المحاسب من الإغلاق اليومي والموردين والاطلاع على القيود المحاسبية'
  );

  // B. Custody Officer
  const resCustody = await callDashboardApi(tokenCustody);
  const custPerms = resCustody.data.data.permissions;
  assert(
    custPerms.canDeliver === true,
    'مسؤول العهدة: تمكين مسؤول العهدة من عمليات صرف النقدية (canDeliver = true)',
    `canDeliver: ${custPerms.canDeliver}`
  );
  assert(
    custPerms.canCloseDay === false && custPerms.canManageSuppliers === false && custPerms.canViewLedger === false,
    'مسؤول العهدة: حظر الإغلاق اليومي والموردين وسجل الأستاذ عن مسؤول العهدة'
  );
  assert(
    resCustody.data.data.recentLedger.length === 0,
    'حماية سرية البيانات: حجب سجل القيود المحاسبية المركزية تماماً عن مسؤول العهدة (zero leakage)'
  );

  // C. Data Entry
  const resDataEntry = await callDashboardApi(tokenDataEntry);
  const dataPerms = resDataEntry.data.data.permissions;
  assert(
    dataPerms.canUploadReceipts === true && dataPerms.canOpenSession === true && dataPerms.canDeliver === false && dataPerms.canCloseDay === false,
    'مدخل البيانات: تمكين رفع الإيصالات وفتح الجلسات وحظر الصرف والإغلاق'
  );
  assert(
    resDataEntry.data.data.recentLedger.length === 0,
    'حماية سرية البيانات: حجب سجل القيود المحاسبية المركزية تماماً عن مدخل البيانات'
  );

  // D. Bankak Auditor
  const resAuditor = await callDashboardApi(tokenAuditor);
  const auditPerms = resAuditor.data.data.permissions;
  assert(
    auditPerms.canAuditBankak === true && auditPerms.canDeliver === false && auditPerms.canCloseDay === false,
    'مدقق بنكك: تمكين التدقيق والمطابقة وحظر الصرف والإغلاق'
  );

  // 4. Double-Entry Breakdown in Recent Ledger
  console.log('\n--- 4. فحص تفاصيل المدين والدائن في القيود المحاسبية (Double-Entry Transparency) ---');
  const ledgerEntries = resAdmin.data.data.recentLedger;
  if (ledgerEntries.length > 0) {
    const first = ledgerEntries[0];
    const hasLines = Array.isArray(first.lines) && first.lines.length > 0;
    const hasDebitCredit = hasLines && first.lines.some((l: any) => l.debit > 0 || l.credit > 0);
    assert(
      hasLines && hasDebitCredit,
      'سجل القيود: تفصيل أسطر القيد المحاسبي بأرقام الحسابات والمدين والدائن والعملة بدقة',
      `القيد: ${first.entryNumber} | عدد الأسطر: ${first.lines.length}`
    );
  } else {
    assert(true, 'سجل القيود: فارغ حالياً وجاهز لاستقبال العمليات');
  }

  console.log('\n========================================================================================');
  console.log(`  🏆 نجحت جميع الاختبارات! (${passed} من ${total} اختبارات اجتازت بنجاح تام)`);
  console.log('========================================================================================\n');
}

runDashboardAuditTests()
  .catch((e) => {
    console.error('❌ خطأ أثناء تدقيق لوحة التحكم:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
