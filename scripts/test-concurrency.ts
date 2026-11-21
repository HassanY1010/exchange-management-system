import { prisma } from '../lib/db';
import { postLedgerTransaction } from '../lib/accounting/accounting-service';
import Decimal from 'decimal.js';

async function runConcurrencyTests() {
  console.log('========================================================================');
  console.log('  اختبارات التزامن ومنع تضارب العمليات والسباق (Race Conditions Audit) ');
  console.log('  الهدف: إثبات الحماية التامة من التكرار والصرف الزائد تحت الضغط المتزامن');
  console.log('========================================================================\n');

  // ------------------------------------------------------------------------
  // اختبار 1: طلبان متزامنان على عهدة رصيدها 150,000 EGP بمبلغ 100,000 EGP لكل طلب
  // ------------------------------------------------------------------------
  console.log('[اختبار 1] فحص التزامن على عهدة نقدية:');
  const employee = await prisma.employee.findFirst();
  const custodyAccount = await prisma.account.findFirst({ where: { accountCode: '1050' } });
  const safeAccount = await prisma.account.findFirst({ where: { accountCode: '1010' } });
  const customer = await prisma.customer.findFirst();

  if (!employee || !custodyAccount || !safeAccount || !customer) {
    throw new Error('البيانات الأساسية غير مكتملة');
  }

  // إنشاء عهدة تجريبية برصيد 150,000 EGP
  const testCustody = await prisma.employeeCustody.create({
    data: {
      employeeId: employee.id,
      accountId: custodyAccount.id,
      openingAmount: 150000,
      currentAmount: 150000,
      currency: 'EGP',
      businessDate: new Date().toISOString().split('T')[0],
      status: 'open',
      issuedBy: 'مدير التدقيق',
    },
  });

  console.log(`- تم إنشاء عهدة تجريبية برصيد: ${Number(testCustody.currentAmount).toLocaleString()} EGP`);
  console.log(`- إرسال طلبين متزامنين في نفس الجزء من الثانية: Request A = 100,000 EGP | Request B = 100,000 EGP...`);

  // دالة محاكاة الصرف المتزامن باستخدام القفل السلسلي للصف
  async function attemptCustodyDelivery(reqLabel: string, amount: number) {
    try {
      return await prisma.$transaction(async (tx) => {
        // قفل الصف حصرياً في PostgreSQL لمنع قراءة نفس الرصيد القديم
        const lockedRows = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "currentAmount", "status" FROM "EmployeeCustody" WHERE id = $1 FOR UPDATE',
          testCustody.id
        );
        const locked = lockedRows[0];
        const curAmount = Number(locked.currentAmount);

        if (curAmount < amount) {
          throw new Error(`رصيد العهدة غير كافٍ. المتاح: ${curAmount.toLocaleString()} EGP، المطلوب: ${amount.toLocaleString()} EGP`);
        }

        const newBal = curAmount - amount;
        await tx.employeeCustody.update({
          where: { id: testCustody.id },
          data: { currentAmount: newBal },
        });

        await tx.custodyTransaction.create({
          data: {
            custodyId: testCustody.id,
            transactionType: 'delivery_to_customer',
            amount: amount,
            currency: 'EGP',
            customerId: customer?.id || '',
            description: `صرف تجريبي ${reqLabel}`,
            createdBy: 'فاحص التزامن',
          },
        });

        return { success: true, reqLabel, remaining: newBal };
      });
    } catch (err: any) {
      return { success: false, reqLabel, error: err.message };
    }
  }

  // إطلاق الطلبين معاً عبر Promise.all في نفس اللحظة
  const [resA, resB] = await Promise.all([
    attemptCustodyDelivery('Request A (100k)', 100000),
    attemptCustodyDelivery('Request B (100k)', 100000),
  ]);

  console.log(`- نتيجة الطلب A: ${resA.success ? `نجح ✅ (المتبقي: ${resA.remaining?.toLocaleString()} EGP)` : `رُفض ❌ (${resA.error})`}`);
  console.log(`- نتيجة الطلب B: ${resB.success ? `نجح ✅ (المتبقي: ${resB.remaining?.toLocaleString()} EGP)` : `رُفض ❌ (${resB.error})`}`);

  const custodyAfter = await prisma.employeeCustody.findUnique({ where: { id: testCustody.id } });
  console.log(`- الرصيد النهائي المسجل في قاعدة البيانات للعهدة: ${Number(custodyAfter?.currentAmount).toLocaleString()} EGP`);

  const successCount = (resA.success ? 1 : 0) + (resB.success ? 1 : 0);
  if (successCount !== 1) {
    throw new Error(`فشل اختبار التزامن: عدد الطلبات الناجحة ${successCount} بينما يجب أن ينجح طلب واحد فقط!`);
  }
  if (Number(custodyAfter?.currentAmount) !== 50000) {
    throw new Error(`خطأ في الرصيد المتبقي: المتوقع 50,000 ولكن الفعلي ${custodyAfter?.currentAmount}`);
  }
  console.log('✅ اختبار التزامن على العهدة نجح 100%: تم قبول طلب واحد فقط والمحافظة على الرصيد 50,000 EGP دون حدوث Race Condition.\n');

  // ------------------------------------------------------------------------
  // اختبار 2: طلبان متزامنان لاعتماد نفس إيصال بنكك (Double Click / Concurrent Approval)
  // ------------------------------------------------------------------------
  console.log('[اختبار 2] فحص التزامن واعتماد إيصال بنكك مرتين (Double Click):');
  const testReceipt = await prisma.bankakReceipt.create({
    data: {
      receiptNumber: `RCP-CONC-${Date.now()}`,
      transactionId: `TXN-CONC-${Date.now()}`,
      amount: 500000,
      currency: 'SDG',
      bankName: 'بنك الخرطوم',
      imageStorageKey: 'sample.png',
      imageHash: `hash-conc-${Date.now()}`,
      status: 'pending_review',
      createdBy: 'مدير التدقيق',
    },
  });

  console.log(`- تم إنشاء إيصال معلق برقم عملية: ${testReceipt.transactionId}`);
  console.log(`- إرسال طلبين متزامنين للاعتماد في نفس اللحظة...`);

  async function attemptApproveReceipt(clickLabel: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "status" FROM "BankakReceipt" WHERE id = $1 FOR UPDATE',
          testReceipt.id
        );
        if (!locked || locked.length === 0) throw new Error('الإيصال غير موجود');
        if (locked[0].status === 'approved') {
          throw new Error('تم اعتماد هذا الإيصال مسبقاً ولا يمكن اعتماده مرتين');
        }

        await tx.bankakReceipt.update({
          where: { id: testReceipt.id },
          data: { status: 'approved', approvedBy: clickLabel, approvedAt: new Date() },
        });

        return { success: true, clickLabel };
      });
    } catch (err: any) {
      return { success: false, clickLabel, error: err.message };
    }
  }

  const [click1, click2] = await Promise.all([
    attemptApproveReceipt('Click 1'),
    attemptApproveReceipt('Click 2'),
  ]);

  console.log(`- نتيجة النقرة الأولى: ${click1.success ? 'نجحت الاعتماد ✅' : `رُفضت ❌ (${click1.error})`}`);
  console.log(`- نتيجة النقرة الثانية: ${click2.success ? 'نجحت الاعتماد ✅' : `رُفضت ❌ (${click2.error})`}`);

  const approvedSuccessCount = (click1.success ? 1 : 0) + (click2.success ? 1 : 0);
  if (approvedSuccessCount !== 1) {
    throw new Error('فشل اختبار منع الاعتماد المزدوج للإيصالات');
  }
  console.log('✅ اختبار منع الاعتماد المكرر نجح 100%: تم قبول اعتماد واحد ورفض التكرار التزامني.\n');

  // ------------------------------------------------------------------------
  // اختبار 3: طلبان متزامنان لتحويل أموال من خزينة رصيدها لا يكفي سوى لتحويل واحد
  // ------------------------------------------------------------------------
  console.log('[اختبار 3] فحص التزامن في التحويل بين الحسابات والخزائن:');
  const tempSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-${Date.now().toString().slice(-4)}`,
      name: 'خزينة اختبار التزامن',
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 50000,
      currentBalance: 50000,
    },
  });

  console.log(`- الخزينة المصدر رصيدها الحالي: ${Number(tempSafe.currentBalance).toLocaleString()} EGP`);
  console.log(`- إرسال تحويلين متزامنين بقيمة 40,000 EGP لكل منهما إلى الخزينة الرئيسية...`);

  async function attemptTransfer(transferLabel: string) {
    try {
      await postLedgerTransaction({
        entryType: 'fund_transfer',
        description: `تحويل تجريبي متزامن ${transferLabel}`,
        createdBy: 'فاحص التزامن',
        lines: [
          {
            accountId: safeAccount.id,
            currency: 'EGP',
            debit: 40000,
            credit: 0,
            description: `إيداع متزامن`,
          },
          {
            accountId: tempSafe.id,
            currency: 'EGP',
            debit: 0,
            credit: 40000,
            description: `خصم متزامن`,
          },
        ],
      });
      return { success: true, transferLabel };
    } catch (err: any) {
      return { success: false, transferLabel, error: err.message };
    }
  }

  const [t1, t2] = await Promise.all([
    attemptTransfer('Transfer 1 (40k)'),
    attemptTransfer('Transfer 2 (40k)'),
  ]);

  console.log(`- نتيجة التحويل 1: ${t1.success ? 'نجح ✅' : `رُفض ❌ (${t1.error})`}`);
  console.log(`- نتيجة التحويل 2: ${t2.success ? 'نجح ✅' : `رُفض ❌ (${t2.error})`}`);

  const updatedTempSafe = await prisma.account.findUnique({ where: { id: tempSafe.id } });
  console.log(`- رصيد الخزينة النهائي: ${Number(updatedTempSafe?.currentBalance).toLocaleString()} EGP`);

  const transferSuccessCount = (t1.success ? 1 : 0) + (t2.success ? 1 : 0);
  if (transferSuccessCount !== 1) {
    throw new Error('فشل اختبار التحويل المتزامن: تم السماح بتحويل مبالغ تتجاوز رصيد الخزينة');
  }
  if (Number(updatedTempSafe?.currentBalance) !== 10000) {
    throw new Error(`الرصيد النهائي غير صحيح: المتوقع 10,000 ولكن الفعلي ${updatedTempSafe?.currentBalance}`);
  }
  console.log('✅ اختبار التحويل المتزامن نجح 100%: تم منع سحب 80,000 من رصيد 50,000 EGP واكتملت العملية بأمان تام.\n');

  console.log('========================================================================');
  console.log('  🏆 انتهت اختبارات التزامن بنجاح تام 100% وبأعلى معايير الأمان المالي!');
  console.log('========================================================================\n');
}

runConcurrencyTests()
  .catch((err) => {
    console.error('❌ خطأ في اختبارات التزامن:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
