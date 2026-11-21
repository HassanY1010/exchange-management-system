import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { postLedgerTransaction } from '../lib/accounting/accounting-service';

const prisma = new PrismaClient();

async function runRbacHardeningTests() {
  console.log('========================================================================================');
  console.log('  اختبارات التحقق الصارم من تشديد صلاحيات صرف النقدية (RBAC Payout Hardening Audit)      ');
  console.log('  الهدف: حظر المحاسب accountant من الصرف، تمكين custody_officer، وضبط استثناءات admin   ');
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

  try {
    // 1. Setup customer and tokens
    let customer = await prisma.customer.findFirst();
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          customerCode: 'CUST-RBAC-01',
          name: 'عميل اختبار الصلاحيات',
          phone: '0999887766',
        }
      });
    }

    const tokenAnonymous = '';
    const tokenDataEntry = generateToken({ userId: 'u-data', email: 'data@test.com', name: 'مدخل بيانات', role: 'data_entry' });
    const tokenAuditor = generateToken({ userId: 'u-audit', email: 'audit@test.com', name: 'مراجع بنكك', role: 'bankak_auditor' });
    const tokenAccountant = generateToken({ userId: 'u-acct', email: 'acct@test.com', name: 'المحاسب المالي', role: 'accountant' });
    const tokenCustody = generateToken({ userId: 'u-cust', email: 'cust@test.com', name: 'أمين الصندوق والعهدة', role: 'custody_officer' });
    const tokenAdmin = generateToken({ userId: 'u-admin', email: 'admin@test.com', name: 'المدير العام', role: 'admin' });

    const safeEgp = await prisma.account.findFirst({ where: { accountCode: '1010' } });
    if (!safeEgp) throw new Error('Safe account 1010 not found');

    const ts = Date.now();

    // Create a ready-for-payout customer session
    const readySession = await prisma.customerSession.create({
      data: {
        sessionNumber: `SES-RBAC-${ts}`,
        customerId: customer.id,
        businessDate: '2026-11-21',
        createdBy: 'مدقق الصلاحيات',
        requestedAmount: 5000,
        expectedAmount: 1000000,
        receivedAmount: 1000000, // fully received & approved
        deliveredAmount: 0,
        exchangeRate: 200,
        status: 'pending_delivery',
      }
    });

    console.log('--- 1. اختبار مصفوفة أدوار صرف النقدية (Deliver API Role Matrix) ---');

    // Helper to simulate calling the POST /api/v1/customer-sessions/[id]/deliver route logic
    async function simulateDeliverCall(userToken: string, sessionId: string, body: any = {}) {
      const { getUserFromRequest } = await import('../lib/auth');
      const { NextRequest } = await import('next/server');
      const { POST } = await import('../app/api/v1/customer-sessions/[id]/deliver/route');

      const headers: any = { 'Content-Type': 'application/json' };
      if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

      const req = new NextRequest(`http://localhost:3000/api/v1/customer-sessions/${sessionId}/deliver`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const res = await POST(req, { params: { id: sessionId } });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }

    // A. Anonymous -> 401
    const resAnon = await simulateDeliverCall(tokenAnonymous, readySession.id);
    assert(resAnon.status === 401, 'Anonymous: محاولة الصرف بدون تسجيل دخول ترد بـ 401 Unauthorized', `الكود: ${resAnon.status}`);

    // B. data_entry -> 403
    const resDataEntry = await simulateDeliverCall(tokenDataEntry, readySession.id);
    assert(resDataEntry.status === 403, 'Data Entry: محاولة الصرف من مدخل البيانات ترد بـ 403 Forbidden', `الكود: ${resDataEntry.status}`);

    // C. bankak_auditor -> 403
    const resAuditor = await simulateDeliverCall(tokenAuditor, readySession.id);
    assert(resAuditor.status === 403, 'Bankak Auditor: محاولة الصرف من مراجع بنكك ترد بـ 403 Forbidden', `الكود: ${resAuditor.status}`);

    // D. accountant -> 403 (THE CORE REQUIREMENT)
    const vouchersBeforeAcct = await prisma.cashPayoutVoucher.count({ where: { customerSessionId: readySession.id } });
    const ledgerLinesBeforeAcct = await prisma.ledgerLine.count();
    const safeBalBeforeAcct = Number((await prisma.account.findUnique({ where: { id: safeEgp.id } }))?.currentBalance);

    const resAcct = await simulateDeliverCall(tokenAccountant, readySession.id, {
      amountEgp: 5000,
      recipientName: 'عمر العميل',
      idempotencyKey: `idem-acct-${ts}`,
    });

    const vouchersAfterAcct = await prisma.cashPayoutVoucher.count({ where: { customerSessionId: readySession.id } });
    const ledgerLinesAfterAcct = await prisma.ledgerLine.count();
    const safeBalAfterAcct = Number((await prisma.account.findUnique({ where: { id: safeEgp.id } }))?.currentBalance);
    const sessionAfterAcct = await prisma.customerSession.findUnique({ where: { id: readySession.id } });

    assert(
      resAcct.status === 403 &&
      resAcct.data.error.includes('مقتصرة على مسؤول العهدة') &&
      vouchersBeforeAcct === vouchersAfterAcct &&
      ledgerLinesBeforeAcct === ledgerLinesAfterAcct &&
      safeBalBeforeAcct === safeBalAfterAcct &&
      sessionAfterAcct?.status === 'pending_delivery',
      'Accountant: حظر المحاسب رسمياً من صرف النقدية (403 Forbidden) دون إنشاء أي سند أو قيد أو خصم رصيد',
      `كود الاستجابة: ${resAcct.status} | رسالة المنع: ${resAcct.data.error}`
    );

    console.log('\n--- 2. اختبار صلاحيات مسؤول العهدة والتسليم (Custody Officer Deliver Test) ---');

    // E. custody_officer -> 200 when ready
    const resCustody = await simulateDeliverCall(tokenCustody, readySession.id, {
      amountEgp: 5000,
      recipientName: 'عمر العميل',
      idempotencyKey: `idem-cust-${ts}`,
    });

    const sessionAfterCustody = await prisma.customerSession.findUnique({ where: { id: readySession.id } });
    const voucherCustody = await prisma.cashPayoutVoucher.findFirst({ where: { customerSessionId: readySession.id } });

    assert(
      resCustody.status === 200 &&
      resCustody.data.success === true &&
      sessionAfterCustody?.status === 'completed' &&
      voucherCustody !== null,
      'Custody Officer: يستطيع مسؤول العهدة صرف النقدية بنجاح وإصدار سند الصرف وإغلاق الجلسة',
      `رقم السند الصادر: ${voucherCustody?.voucherNumber} | حالة الجلسة: ${sessionAfterCustody?.status}`
    );

    // F. custody_officer duplicate payout -> blocked
    const resCustodyDup = await simulateDeliverCall(tokenCustody, readySession.id, {
      amountEgp: 5000,
      recipientName: 'عمر العميل',
    });
    assert(
      resCustodyDup.status === 500 && resCustodyDup.data.error.includes('مسبقاً'),
      'Custody Officer: منع تكرار الصرف لجلسة تم صرفها مسبقاً',
      `الرسالة: ${resCustodyDup.data.error}`
    );

    console.log('\n--- 3. اختبار الصلاحيات الاستثنائية للمدير العام (Admin Controls & Exceptions) ---');

    // Create an incomplete session (receivedAmount < expectedAmount)
    const incompleteSession = await prisma.customerSession.create({
      data: {
        sessionNumber: `SES-INC-${ts}`,
        customerId: customer.id,
        businessDate: '2026-11-21',
        createdBy: 'مدقق الصلاحيات',
        requestedAmount: 2000,
        expectedAmount: 400000,
        receivedAmount: 200000, // only half received
        deliveredAmount: 0,
        exchangeRate: 200,
        status: 'has_balance',
      }
    });

    // Custody officer trying to bypass unverified session -> rejected
    const resCustodyBypass = await simulateDeliverCall(tokenCustody, incompleteSession.id, {
      amountEgp: 1000,
      allowPartial: true, // custody cannot bypass
    });
    assert(
      resCustodyBypass.status === 500 && resCustodyBypass.data.error.includes('قبل استيفاء واعتماد'),
      'Custody Officer: حظر مسؤول العهدة من تجاوز شرط اكتمال الإيصالات المعتمدة',
      `الرسالة: ${resCustodyBypass.data.error}`
    );

    // Admin trying bypass WITHOUT valid reason -> rejected with 500
    const resAdminNoReason = await simulateDeliverCall(tokenAdmin, incompleteSession.id, {
      amountEgp: 1000,
      allowPartial: true,
      notes: '', // empty reason
    });
    assert(
      resAdminNoReason.status === 500 && resAdminNoReason.data.error.includes('سبب توثيقي إلزامي'),
      'Admin: حظر التجاوز الاستثنائي للمدير بدون سبب توثيقي إلزامي (أقل من 5 أحرف)',
      `الرسالة: ${resAdminNoReason.data.error}`
    );

    // Admin bypass WITH valid reason -> accepted and logged in AuditLog
    const resAdminWithReason = await simulateDeliverCall(tokenAdmin, incompleteSession.id, {
      amountEgp: 1000,
      allowPartial: true,
      notes: 'موافقة خاصة من الإدارة العليا لصرف دفعة طارئة للعميل',
    });

    const exceptionalAudit = await prisma.auditLog.findFirst({
      where: {
        entityId: incompleteSession.id,
        action: 'EXCEPTIONAL_CASH_DELIVERY',
      },
      orderBy: { createdAt: 'desc' }
    });

    assert(
      resAdminWithReason.status === 200 &&
      exceptionalAudit !== null &&
      exceptionalAudit.reason?.includes('موافقة خاصة من الإدارة العليا'),
      'Admin: الصرف الاستثنائي للمدير يسجل بنجاح مع توثيق السبب الإلزامي في سجل التدقيق AuditLog',
      `نوع العملية المسجلة: ${exceptionalAudit?.action} | السبب الموثق: ${exceptionalAudit?.reason}`
    );

    console.log('\n--- 4. التحقق من سلامة الأستاذ العام وتطابق القيود بعد العمليات ---');

    const totalDeb: any = await prisma.$queryRawUnsafe(`SELECT SUM("debit") as d FROM "LedgerLine"`);
    const totalCred: any = await prisma.$queryRawUnsafe(`SELECT SUM("credit") as c FROM "LedgerLine"`);
    const dVal = Number(totalDeb[0].d).toFixed(2);
    const cVal = Number(totalCred[0].c).toFixed(2);

    assert(
      dVal === cVal,
      'تطابق سجل الأستاذ العام بنسبة 100% بعد جميع حركات الصرف العادية والاستثنائية',
      `مجموع المدين: ${dVal} | مجموع الدائن: ${cVal} | الفرق: 0.00`
    );

    console.log('\n========================================================================================');
    console.log(`  🏆 نجحت جميع اختبارات تشديد الصلاحيات وفصل المهام بنسبة 100% (${passed}/${total})!`);
    console.log('========================================================================================\n');

  } finally {
    await prisma.$disconnect();
  }
}

runRbacHardeningTests().catch(err => {
  console.error('Fatal RBAC test error:', err);
  process.exit(1);
});
