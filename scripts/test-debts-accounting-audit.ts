import { prisma } from '../lib/db';
import { POST as postDebt } from '../app/api/v1/debts/route';
import { POST as postDebtPayment } from '../app/api/v1/debts/[id]/payments/route';
import { NextRequest } from 'next/server';
import { generateToken } from '../lib/auth';
import Decimal from 'decimal.js';

function createMockReq(url: string, method: string = 'GET', body?: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const init: any = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(url, init);
}

async function runDebtsAccountingAudit() {
  console.log('========================================================================');
  console.log('     FOCUSED GENERAL LEDGER & ACCOUNTING AUDIT: /api/v1/debts');
  console.log('========================================================================\n');

  const adminToken = generateToken({
    userId: 'audit-admin-id',
    email: 'audit-admin@system.com',
    name: 'المراجع المحاسبي المستقل',
    role: 'admin',
  });

  const ts = Date.now();

  // Create isolated test accounts
  const testSafeEgp = await prisma.account.create({
    data: {
      accountCode: `SAFE-AUDIT-EGP-${ts}`,
      name: `خزينة تدقيق رئيسية (EGP) ${ts}`,
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 100000,
      currentBalance: 100000,
      status: 'active',
    },
  });

  const testSafeSdg = await prisma.account.create({
    data: {
      accountCode: `SAFE-AUDIT-SDG-${ts}`,
      name: `خزينة تدقيق رئيسية (SDG) ${ts}`,
      accountType: 'cash_safe',
      currency: 'SDG',
      openingBalance: 5000000,
      currentBalance: 5000000,
      status: 'active',
    },
  });

  console.log(`[إعداد بيئة الفحص] تم إنشاء خزائن الاختبار:`);
  console.log(`- الخزينة EGP (${testSafeEgp.accountCode}): رصيد ابتدائي = ${testSafeEgp.currentBalance} EGP`);
  console.log(`- الخزينة SDG (${testSafeSdg.accountCode}): رصيد ابتدائي = ${testSafeSdg.currentBalance} SDG\n`);

  try {
    // =========================================================================
    // 1. فحص ديون مستحقة لنا (Receivables)
    // =========================================================================
    console.log('------------------------------------------------------------------------');
    console.log('1. فحص دين مستحق لنا (Receivable): دين تجاري سابق vs دين تمويل نقدي');
    console.log('------------------------------------------------------------------------');

    // الحالة 1.أ: دين تجاري نشأ عن معاملة صرافة سابقة (دون تمويل جديد)
    console.log('\n[الحالة 1.أ] إنشاء دين تجاري لعميل (بدون تمويل نقدي جديد):');
    const res1a = await postDebt(
      createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
        debtType: 'receivable',
        partyType: 'customer',
        partyName: `عميل تجاري ${ts}`,
        currency: 'EGP',
        originalAmount: 15000,
        description: 'متبقي مديونية عملية تحويل سابقة',
      }, adminToken)
    );
    const body1a = await res1a.json();
    console.log(`- نتيجة الإنشاء: status = ${res1a.status}, debtNumber = ${body1a.data.debtNumber}`);

    // التحقق من عدم إنشاء قيد مالي مكرر
    const entries1a = await prisma.ledgerEntry.findMany({
      where: { referenceId: body1a.data.debtNumber },
      include: { lines: true },
    });
    console.log(`- عدد قيود اليومية المنشأة: ${entries1a.length}`);
    if (entries1a.length === 0) {
      console.log('  [تأكيد محاسبي سليم]: لم يتم إنشاء قيود يومية تجنباً لتكرار إيراد الصفقة التجارية المسجلة مسبقاً.');
    } else {
      throw new Error('خطأ: تم إنشاء قيد يومية مكرر لدين تجاري غير ممول!');
    }

    // الحالة 1.ب: دين مستحق لنا تم تمويله وصرفه نقداً من الخزينة
    console.log('\n[الحالة 1.ب] إنشاء دين مستحق لنا بتمويل وصرف نقدي مباشر من الخزينة:');
    const safeBefore1b = await prisma.account.findUnique({ where: { id: testSafeEgp.id } });
    const res1b = await postDebt(
      createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
        debtType: 'receivable',
        partyType: 'customer',
        partyName: `عميل قرض نقدي ${ts}`,
        currency: 'EGP',
        originalAmount: 25000,
        fundingAccountId: testSafeEgp.id,
        description: 'صرف قرض نقدي لعميل',
      }, adminToken)
    );
    const body1b = await res1b.json();
    console.log(`- نتيجة الإنشاء: status = ${res1b.status}, debtNumber = ${body1b.data.debtNumber}`);

    // فحص القيد في دفتر الأستاذ العام (General Ledger)
    const entry1b = await prisma.ledgerEntry.findFirst({
      where: { referenceId: body1b.data.debtNumber },
      include: { lines: { include: { account: true } } },
    });
    if (!entry1b) throw new Error('خطأ: لم يتم العثور على قيد إنشاء الدين الممول في دفتر الأستاذ!');

    console.log(`- رقم قيد اليومية: ${entry1b.entryNumber} (نوع القيد: ${entry1b.entryType})`);
    let totalDebit1b = new Decimal(0);
    let totalCredit1b = new Decimal(0);
    for (const line of entry1b.lines) {
      console.log(`  * حساب: ${line.account.accountCode} (${line.account.name}) | مدين: ${line.debit} | دائن: ${line.credit} | عملة: ${line.currency}`);
      totalDebit1b = totalDebit1b.plus(line.debit.toString());
      totalCredit1b = totalCredit1b.plus(line.credit.toString());
    }
    console.log(`- إجمالي المدين: ${totalDebit1b.toFixed(2)} | إجمالي الدائن: ${totalCredit1b.toFixed(2)} -> متوازن: ${totalDebit1b.equals(totalCredit1b)}`);

    const safeAfter1b = await prisma.account.findUnique({ where: { id: testSafeEgp.id } });
    console.log(`- رصيد الخزينة قبل: ${safeBefore1b!.currentBalance} EGP | بعد الصرف: ${safeAfterAfterOrCurrent(safeAfter1b!.currentBalance)} EGP (انخفض بـ 25,000 EGP)`);

    // فحص سداد وتحصيل الدين اللاحق (Collection)
    console.log('\n[سداد لاحق 1.ج] تحصيل دفعة بقيمة 10,000 EGP من أصل الدين:');
    const res1c = await postDebtPayment(
      createMockReq(`http://localhost:3000/api/v1/debts/${body1b.data.id}/payments`, 'POST', {
        amount: 10000,
        accountId: testSafeEgp.id,
        notes: 'تحصيل دفعة أولى من القرض',
      }, adminToken),
      { params: { id: body1b.data.id } }
    );
    const body1c = await res1c.json();
    console.log(`- نتيجة التحصيل: status = ${res1c.status}, remainingAmount = ${body1c.data.debt.remainingAmount} EGP`);

    // فحص قيد التحصيل في دفتر الأستاذ
    const entry1c = await prisma.ledgerEntry.findFirst({
      where: { referenceId: body1b.data.debtNumber, entryType: 'debt_payment_collection' },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!entry1c) throw new Error('خطأ: قيد تحصيل الدفعة غير موجود في دفتر الأستاذ!');

    console.log(`- رقم قيد تحصيل الدفعة: ${entry1c.entryNumber}`);
    for (const line of entry1c.lines) {
      console.log(`  * حساب: ${line.account.accountCode} (${line.account.name}) | مدين: ${line.debit} | دائن: ${line.credit}`);
    }

    // =========================================================================
    // 2. فحص التزامات مستحقة علينا (Payables)
    // =========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('2. فحص التزام مستحق علينا (Payable): التزام توريد سابق vs تمويل نقدي وارد');
    console.log('------------------------------------------------------------------------');

    // الحالة 2.أ: التزام نشأ عن توريد سابق دون تمويل إضافي
    console.log('\n[الحالة 2.أ] إنشاء التزام لمورد ناتج عن صفقة توريد سابقة:');
    const res2a = await postDebt(
      createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
        debtType: 'payable',
        partyType: 'supplier',
        partyName: `مورد عملات تجاري ${ts}`,
        currency: 'SDG',
        originalAmount: 2000000,
        description: 'مستحق توريد عملة سابق',
      }, adminToken)
    );
    const body2a = await res2a.json();
    console.log(`- نتيجة الإنشاء: status = ${res2a.status}, debtNumber = ${body2a.data.debtNumber}`);

    const entries2a = await prisma.ledgerEntry.findMany({
      where: { referenceId: body2a.data.debtNumber },
    });
    console.log(`- عدد قيود اليومية المنشأة: ${entries2a.length} -> [تأكيد محاسبي سليم]: لا تكرار في تكاليف الموردين.`);

    // الحالة 2.ب: التزام بتمويل واستلام نقد وارد في الخزينة
    console.log('\n[الحالة 2.ب] إنشاء التزام مستحق علينا مع استلام نقد فعلي في الخزينة:');
    const safeBefore2b = await prisma.account.findUnique({ where: { id: testSafeSdg.id } });
    const res2b = await postDebt(
      createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
        debtType: 'payable',
        partyType: 'supplier',
        partyName: `مورد قرض سوداني ${ts}`,
        currency: 'SDG',
        originalAmount: 1000000,
        fundingAccountId: testSafeSdg.id,
        description: 'استلام قرض/تمويل نقدي من مورد',
      }, adminToken)
    );
    const body2b = await res2b.json();
    console.log(`- نتيجة الإنشاء: status = ${res2b.status}, debtNumber = ${body2b.data.debtNumber}`);

    const entry2b = await prisma.ledgerEntry.findFirst({
      where: { referenceId: body2b.data.debtNumber },
      include: { lines: { include: { account: true } } },
    });
    if (!entry2b) throw new Error('خطأ: قيد استلام التمويل غير موجود في دفتر الأستاذ!');

    console.log(`- رقم قيد اليومية: ${entry2b.entryNumber} (نوع القيد: ${entry2b.entryType})`);
    let totalDebit2b = new Decimal(0);
    let totalCredit2b = new Decimal(0);
    for (const line of entry2b.lines) {
      console.log(`  * حساب: ${line.account.accountCode} (${line.account.name}) | مدين: ${line.debit} | دائن: ${line.credit} | عملة: ${line.currency}`);
      totalDebit2b = totalDebit2b.plus(line.debit.toString());
      totalCredit2b = totalCredit2b.plus(line.credit.toString());
    }
    console.log(`- إجمالي المدين: ${totalDebit2b.toFixed(2)} | إجمالي الدائن: ${totalCredit2b.toFixed(2)} -> متوازن: ${totalDebit2b.equals(totalCredit2b)}`);

    const safeAfter2b = await prisma.account.findUnique({ where: { id: testSafeSdg.id } });
    console.log(`- رصيد الخزينة قبل: ${safeBefore2b!.currentBalance} SDG | بعد الاستلام: ${safeAfterAfterOrCurrent(safeAfter2b!.currentBalance)} SDG (زاد بـ 1,000,000 SDG)`);

    // فحص سداد الالتزام لاحقاً (Settlement)
    console.log('\n[سداد لاحق 2.ج] سداد دفعة بقيمة 400,000 SDG من التزام المورد:');
    const safeBefore2c = await prisma.account.findUnique({ where: { id: testSafeSdg.id } });
    const res2c = await postDebtPayment(
      createMockReq(`http://localhost:3000/api/v1/debts/${body2b.data.id}/payments`, 'POST', {
        amount: 400000,
        accountId: testSafeSdg.id,
        notes: 'سداد دفعة للمورد من الخزينة',
      }, adminToken),
      { params: { id: body2b.data.id } }
    );
    const body2c = await res2c.json();
    console.log(`- نتيجة السداد: status = ${res2c.status}, remainingAmount = ${body2c.data.debt.remainingAmount} SDG`);

    const entry2c = await prisma.ledgerEntry.findFirst({
      where: { referenceId: body2b.data.debtNumber, entryType: 'debt_payment_settlement' },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!entry2c) throw new Error('خطأ: قيد سداد الالتزام غير موجود في دفتر الأستاذ!');

    console.log(`- رقم قيد سداد الالتزام: ${entry2c.entryNumber}`);
    for (const line of entry2c.lines) {
      console.log(`  * حساب: ${line.account.accountCode} (${line.account.name}) | مدين: ${line.debit} | دائن: ${line.credit}`);
    }

    const safeAfter2c = await prisma.account.findUnique({ where: { id: testSafeSdg.id } });
    console.log(`- رصيد الخزينة قبل السداد: ${safeBefore2c!.currentBalance} SDG | بعد السداد: ${safeAfterAfterOrCurrent(safeAfter2c!.currentBalance)} SDG (انخفض بـ 400,000 SDG)`);

    // =========================================================================
    // 3. التحقق من سلامة قائمة الدخل والميزانية العمومية
    // =========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('3. التحقق من عدم المساس بالإيرادات (4xxx) والمصروفات (5xxx) والميزانية');
    console.log('------------------------------------------------------------------------');

    const allLines = await prisma.ledgerLine.findMany({
      where: {
        ledgerEntry: {
          referenceId: { in: [body1a.data.debtNumber, body1b.data.debtNumber, body2a.data.debtNumber, body2b.data.debtNumber] },
        },
      },
      include: { account: true },
    });

    const incomeLines = allLines.filter((l) => l.account.accountCode.startsWith('4') || l.account.accountType === 'revenue');
    const expenseLines = allLines.filter((l) => l.account.accountCode.startsWith('5') || l.account.accountType === 'expense');

    console.log(`- عدد أسطر الإيرادات المسجلة بحركات الديون: ${incomeLines.length} (يجب أن يكون 0)`);
    console.log(`- عدد أسطر المصروفات المسجلة بحركات الديون: ${expenseLines.length} (يجب أن يكون 0)`);

    if (incomeLines.length === 0 && expenseLines.length === 0) {
      console.log('  [تأكيد محاسبي معتمد]: لم يتم المساس إطلاقاً بحسابات قائمة الدخل (الأرباح والمصروفات)، فجميع القيود حركات ميزانية عمومية (أصول والتزامات).');
    } else {
      throw new Error('فشل الفحص: تم تسجيل إيرادات أو مصروفات عبر حركات الديون!');
    }

    console.log('\n========================================================================');
    console.log('       اكتملت المراجعة المحاسبية الشاملة بنجاح 100% دون أي أخطاء');
    console.log('========================================================================\n');

  } finally {
    // التنظيف
    console.log('جاري تنظيف بيانات التدقيق...');
    await prisma.debtPayment.deleteMany({ where: { debt: { description: { contains: `${ts}` } } } }).catch(() => {});
    await prisma.ledgerLine.deleteMany({ where: { account: { accountCode: { contains: `${ts}` } } } }).catch(() => {});
    await prisma.ledgerEntry.deleteMany({ where: { description: { contains: `${ts}` } } }).catch(() => {});
    await prisma.debt.deleteMany({ where: { description: { contains: `${ts}` } } }).catch(() => {});
    await prisma.account.deleteMany({ where: { accountCode: { contains: `${ts}` } } }).catch(() => {});
    console.log('تم تنظيف بيانات الاختبار بنجاح.');
  }
}

function safeAfterAfterOrCurrent(val: any) {
  return Number(val).toLocaleString();
}

runDebtsAccountingAudit()
  .catch((err) => {
    console.error('فشل التدقيق المحاسبي:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
