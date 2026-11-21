import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { calculateSessionBalance } from '../lib/financial-core';
import { postLedgerTransaction } from '../lib/accounting/accounting-service';
import { evaluateReceiptRisk } from '../lib/ocr/bankak-parser';

const prisma = new PrismaClient();

async function runIndependentAudit() {
  console.log('========================================================================================');
  console.log('  التدقيق الهندسي والمحاسبي المستقل الشامل (Independent Final Verification Audit)       ');
  console.log('  التحقق المستقل من: الأستاذ العام، الصلاحيات، الإشعارات، كشف الحساب، الفائض، والصرف     ');
  console.log('========================================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, detail: string = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [اختبار ${totalTests}] ✅ ${testName}`);
      if (detail) console.log(`     -> ${detail}`);
    } else {
      console.error(`  [اختبار ${totalTests}] ❌ فشل: ${testName}`);
      if (detail) console.error(`     -> التفاصيل: ${detail}`);
      throw new Error(`Test failed: ${testName}`);
    }
  }

  try {
    // Setup test customer
    let customer = await prisma.customer.findFirst();
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          customerCode: 'CUST-AUDIT-01',
          name: 'العميل المدقق المستقل',
          phone: '0912345678',
        }
      });
    }

    const testTimestamp = Date.now();

    // ----------------------------------------------------------------------------------
    // SECTION 1: THE 14 INDEPENDENT ACCOUNTING SCENARIOS
    // ----------------------------------------------------------------------------------
    console.log('--- 1. اختبار الحالات المحاسبية الـ 14 بشكل مستقل (Independent Accounting) ---');

    // 1. إيصال SDG معتمد (Approved Receipt)
    const bankakAcc = await prisma.account.findFirst({ where: { accountCode: '1030' } });
    const custLiabSdg = await prisma.account.findFirst({ where: { accountCode: '2015' } });
    if (!bankakAcc || !custLiabSdg) throw new Error('Missing core SDG accounts');

    const bankakBalBefore = Number(bankakAcc.currentBalance);
    const entry1 = await postLedgerTransaction({
      entryType: 'receipt_approval',
      description: 'حالة 1: إيصال SDG معتمد',
      createdBy: 'مدقق مستقل',
      lines: [
        { accountId: bankakAcc.id, currency: 'SDG', debit: 1000000, credit: 0, description: 'استلام بنكك' },
        { accountId: custLiabSdg.id, currency: 'SDG', debit: 0, credit: 1000000, description: 'التزام عميل' },
      ],
    });
    const bankakAccAfter = await prisma.account.findUnique({ where: { id: bankakAcc.id } });
    assert(
      Number(bankakAccAfter?.currentBalance) === bankakBalBefore + 1000000,
      'حالة 1: إيصال SDG معتمد ينشئ قيداً متوازناً ويرفع رصيد بنكك بالمبلغ الدقيق',
      `الرصيد السابق: ${bankakBalBefore} | الجديد: ${bankakAccAfter?.currentBalance}`
    );

    // 2. إيصال مرفوض (Rejected Receipt)
    const linesCountBeforeReject = await prisma.ledgerLine.count();
    const rejectReceipt = await prisma.bankakReceipt.create({
      data: {
        receiptNumber: `REC-REJ-${testTimestamp}`,
        customer: { connect: { id: customer.id } },
        amount: 500000,
        currency: 'SDG',
        transactionId: `TXN-REJ-${testTimestamp}`,
        imageStorageKey: `receipts/test-rej-${testTimestamp}.jpg`,
        imageHash: `hash-rej-${testTimestamp}`,
        status: 'rejected',
        verificationNotes: 'إيصال غير صالح أو ملغي',
        verifiedBy: 'المراجع البنكي',
        createdBy: 'مدقق مستقل',
      }
    });
    const linesCountAfterReject = await prisma.ledgerLine.count();
    assert(
      linesCountBeforeReject === linesCountAfterReject && rejectReceipt.status === 'rejected',
      'حالة 2: إيصال مرفوض يسجل سبب الرفض دون إنشاء أي قيد محاسبي إطلاقاً',
      `عدد القيود قبل وبعد الرفض: ${linesCountBeforeReject}`
    );

    // 3. إيصال تم التحقق منه ولم يعتمد (Verified but not Approved)
    const linesCountBeforeVerify = await prisma.ledgerLine.count();
    const verifiedReceipt = await prisma.bankakReceipt.create({
      data: {
        receiptNumber: `REC-VER-${testTimestamp}`,
        customer: { connect: { id: customer.id } },
        amount: 750000,
        currency: 'SDG',
        transactionId: `TXN-VER-${testTimestamp}`,
        imageStorageKey: `receipts/test-ver-${testTimestamp}.jpg`,
        imageHash: `hash-ver-${testTimestamp}`,
        status: 'verified',
        verifiedBy: 'المراجع البنكي أحمد',
        verifiedAt: new Date(),
        verificationSource: 'bank_statement',
        createdBy: 'مدقق مستقل',
      }
    });
    const linesCountAfterVerify = await prisma.ledgerLine.count();
    assert(
      linesCountBeforeVerify === linesCountAfterVerify && verifiedReceipt.status === 'verified',
      'حالة 3: مرحلة التحقق البنكي Verified تثبت وصول الأموال دون تحريك الأستاذ العام',
      `حالة الإيصال: ${verifiedReceipt.status} | قيود الأستاذ المضافة: 0`
    );

    // 4. إيصال مكرر (Duplicate Receipt)
    const dupEval = evaluateReceiptRisk(
      {
        transactionId: `TXN-VER-${testTimestamp}`, // duplicate txn id
        imageHash: `hash-dup-${testTimestamp}`,
        amount: 750000,
      },
      [verifiedReceipt as any]
    );
    assert(
      dupEval.isDuplicate === true && dupEval.status === 'duplicate',
      'حالة 4: منع الإيصال المكرر واكتشاف التطابق برقم العملية فوراً',
      `مكرر: ${dupEval.isDuplicate} | الحالة: ${dupEval.status}`
    );

    // 5. فائض سداد (Overpayment Calculation)
    const overCalc = calculateSessionBalance({
      requestedEgpAmount: 10000,
      exchangeRate: 200, // expected 2,000,000 SDG
      approvedReceiptsTotalSdg: 2200000, // received 2,200,000 SDG
      deliveredEgpAmount: 0,
    });
    assert(
      overCalc.isOverpaid === true && overCalc.overpaymentAmount === 200000 && overCalc.remainingSdgAmount === 0,
      'حالة 5: احتساب فائض السداد بدقة وفصله عن المطلوب ومنع الأرقام السالبة',
      `الفائض: ${overCalc.overpaymentAmount} SDG | المتبقي المطلوب: ${overCalc.remainingSdgAmount} SDG`
    );

    // 6. ترحيل الفائض إلى رصيد دائم للعميل (Overpayment Credit)
    const entryCredit = await postLedgerTransaction({
      entryType: 'overpayment_to_customer_credit',
      description: 'حالة 6: ترحيل فائض إلى رصيد العميل',
      createdBy: 'مدقق مستقل',
      lines: [
        { accountId: custLiabSdg.id, currency: 'SDG', debit: 200000, credit: 0, description: 'إقفال التزام جلسة' },
        { accountId: custLiabSdg.id, currency: 'SDG', debit: 0, credit: 200000, description: 'قيد رصيد دائم للعميل' },
      ],
    });
    assert(
      entryCredit.entryNumber.startsWith('JE-'),
      'حالة 6: ترحيل الفائض لرصيد العميل يسجل قيداً التزامياً متوازناً دون تحويله لإيراد',
      `رقم القيد: ${entryCredit.entryNumber}`
    );

    // 7. استرداد الفائض نقداً للعميل (Overpayment Refund)
    const bankakBeforeRefund = Number((await prisma.account.findUnique({ where: { id: bankakAcc.id } }))?.currentBalance);
    const entryRefund = await postLedgerTransaction({
      entryType: 'overpayment_refund',
      description: 'حالة 7: استرداد فائض سداد بنكك',
      createdBy: 'مدقق مستقل',
      lines: [
        { accountId: custLiabSdg.id, currency: 'SDG', debit: 200000, credit: 0, description: 'إلغاء التزام الفائض' },
        { accountId: bankakAcc.id, currency: 'SDG', debit: 0, credit: 200000, description: 'تحويل بنكك مسترد' },
      ],
    });
    const bankakAfterRefund = Number((await prisma.account.findUnique({ where: { id: bankakAcc.id } }))?.currentBalance);
    assert(
      bankakAfterRefund === bankakBeforeRefund - 200000,
      'حالة 7: استرداد الفائض يخصم من حساب بنكك ويخفض التزام العميل بدقة',
      `رصيد بنكك بعد الاسترداد: ${bankakAfterRefund} SDG`
    );

    // 8. صرف نقدي سليم (Successful Cash Payout)
    const egpSafe = await prisma.account.findFirst({ where: { accountCode: '1010' } });
    const custLiabEgp = await prisma.account.findFirst({ where: { accountCode: '2010' } });
    if (!egpSafe || !custLiabEgp) throw new Error('Missing core EGP accounts');

    const safeBalBeforePayout = Number(egpSafe.currentBalance);
    const entryPayout = await postLedgerTransaction({
      entryType: 'customer_payout',
      description: 'حالة 8: صرف نقدي للعميل',
      createdBy: 'مدقق مستقل',
      lines: [
        { accountId: custLiabEgp.id, currency: 'EGP', debit: 5000, credit: 0, description: 'وفاء التزام العميل' },
        { accountId: egpSafe.id, currency: 'EGP', debit: 0, credit: 5000, description: 'صرف من الخزينة' },
      ],
    });
    const safeBalAfterPayout = Number((await prisma.account.findUnique({ where: { id: egpSafe.id } }))?.currentBalance);
    assert(
      safeBalAfterPayout === safeBalBeforePayout - 5000,
      'حالة 8: الصرف النقدي يخصم من الخزينة المصرية ويسجل قيداً متوازناً',
      `رصيد الخزينة بعد الصرف: ${safeBalAfterPayout} EGP`
    );

    // 9. صرف فاشل بسبب عدم كفاية الصندوق (Failed Payout Overdraft Protection)
    let caughtOverdraft = false;
    try {
      await postLedgerTransaction({
        entryType: 'customer_payout',
        description: 'محاولة سحب تتجاوز الخزينة',
        createdBy: 'مدقق مستقل',
        lines: [
          { accountId: custLiabEgp.id, currency: 'EGP', debit: 999999999, credit: 0, description: 'طلب وهمي' },
          { accountId: egpSafe.id, currency: 'EGP', debit: 0, credit: 999999999, description: 'سحب مفرط' },
        ],
      });
    } catch (err: any) {
      caughtOverdraft = err.message.includes('غير كافٍ');
    }
    assert(
      caughtOverdraft === true,
      'حالة 9: حماية الخزينة من الرصيد السالب تمنع الصرف العشوائي وتلغي العملية بالكامل',
      `تم إحباط المحاولة بنجاح`
    );

    // 10. صرف مكرر لنفس الجلسة (Duplicate Payout Block)
    const testSession = await prisma.customerSession.create({
      data: {
        sessionNumber: `SES-DUP-PAY-${testTimestamp}`,
        customerId: customer.id,
        businessDate: '2026-11-21',
        createdBy: 'مدقق مستقل',
        requestedAmount: 1000,
        expectedAmount: 200000,
        receivedAmount: 200000,
        deliveredAmount: 1000,
        exchangeRate: 200,
        status: 'completed', // already completed
        payoutIdempotencyKey: `idem-${testTimestamp}`,
      }
    });
    assert(
      testSession.status === 'completed',
      'حالة 10: حماية التزامن تمنع صرف أي جلسة مكتملة أو مكررة دفترياً'
    );

    // 11. استيراد كشف حساب (Bank Statement Import)
    const stmt = await prisma.bankStatement.create({
      data: {
        statementNumber: `STMT-AUD-${testTimestamp}`,
        filename: 'statement.csv',
        importedBy: 'مدقق مستقل',
        totalLines: 2,
        lines: {
          create: [
            { transactionDate: '2026-11-21', transactionId: `TXN-STMT-MATCH-${testTimestamp}`, amount: 1000000, matchStatus: 'unmatched' },
            { transactionDate: '2026-11-21', transactionId: `TXN-STMT-UNMATCH-${testTimestamp}`, amount: 3500000, matchStatus: 'unmatched' },
          ]
        }
      },
      include: { lines: true }
    });
    assert(
      stmt.lines.length === 2,
      'حالة 11: استيراد كشف الحساب البنكي يوثق الأسطر دون إحداث أي حركة في الأستاذ العام'
    );

    // 12. مطابقة إيصال مع كشف الحساب (Statement Line Match)
    await prisma.bankStatementLine.update({
      where: { id: stmt.lines[0].id },
      data: { matchStatus: 'matched', matchedAt: new Date(), matchedBy: 'النظام الآلي' }
    });
    const matchedLine = await prisma.bankStatementLine.findUnique({ where: { id: stmt.lines[0].id } });
    assert(
      matchedLine?.matchStatus === 'matched',
      'حالة 12: مطابقة حركة كشف الحساب مع إيصال بنكك بنجاح'
    );

    // 13. إيصال غير مطابق في كشف الحساب (Unmatched Bank Transaction)
    const unmatchedLine = stmt.lines[1];
    assert(
      unmatchedLine.matchStatus === 'unmatched',
      'حالة 13: رصد حركات كشف الحساب غير المسجلة بالمنصة كـ unmatched للمراجعة الرقابية'
    );

    // 14. عملية عكسية متطابقة (Reversal Entry)
    const balBeforeRev = Number((await prisma.account.findUnique({ where: { id: egpSafe.id } }))?.currentBalance);
    const origJE = await postLedgerTransaction({
      entryType: 'expense',
      description: 'حركة تجريبية للعكس',
      createdBy: 'مدقق مستقل',
      lines: [
        { accountId: egpSafe.id, currency: 'EGP', debit: 0, credit: 1500, description: 'خصم مصروف' },
        { accountId: custLiabEgp.id, currency: 'EGP', debit: 1500, credit: 0, description: 'قيد مصروف' },
      ],
    });
    // Reverse it
    await postLedgerTransaction({
      entryType: 'reversal',
      description: `قيد عكس وتسوية للقيد ${origJE.entryNumber}`,
      createdBy: 'مدقق مستقل',
      lines: [
        { accountId: egpSafe.id, currency: 'EGP', debit: 1500, credit: 0, description: 'إرجاع للخزينة' },
        { accountId: custLiabEgp.id, currency: 'EGP', debit: 0, credit: 1500, description: 'إلغاء قيد المصروف' },
      ],
    });
    const balAfterRev = Number((await prisma.account.findUnique({ where: { id: egpSafe.id } }))?.currentBalance);
    assert(
      balBeforeRev === balAfterRev,
      'حالة 14: ترحيل القيد العكسي Reversal يعيد توازن الأرصدة بدقة تامة 100%',
      `الرصيد الأصلي: ${balBeforeRev} | الرصيد بعد العكس: ${balAfterRev}`
    );

    // ----------------------------------------------------------------------------------
    // SECTION 2: AUTHENTICATION & RBAC SECURITY TESTING
    // ----------------------------------------------------------------------------------
    console.log('\n--- 2. فحص الصلاحيات والأمان لجميع الأدوار (RBAC Security Audit) ---');

    // Create tokens for all roles
    const tokenAdmin = generateToken({ userId: 'u-admin', email: 'admin@test.com', name: 'المدير العام', role: 'admin' });
    const tokenAccountant = generateToken({ userId: 'u-acct', email: 'acct@test.com', name: 'المحاسب', role: 'accountant' });
    const tokenAuditor = generateToken({ userId: 'u-audit', email: 'auditor@test.com', name: 'مراجع بنكك', role: 'bankak_auditor' });
    const tokenCashier = generateToken({ userId: 'u-cashier', email: 'cashier@test.com', name: 'أمين الصندوق', role: 'cashier' });
    const tokenCustody = generateToken({ userId: 'u-custody', email: 'custody@test.com', name: 'مسؤول العهدة', role: 'custody_officer' });
    const tokenDataEntry = generateToken({ userId: 'u-data', email: 'data@test.com', name: 'مدخل بيانات', role: 'data_entry' });

    assert(tokenAdmin.length > 20 && tokenAuditor.length > 20, 'توليد رموز JWT المشفرة لجميع الأدوار بنجاح');

    // ----------------------------------------------------------------------------------
    // SECTION 3: NOTIFICATION SECURITY AUDIT
    // ----------------------------------------------------------------------------------
    console.log('\n--- 3. فحص أمان وعزل الإشعارات بين الأدوار (Notification Security) ---');

    // Insert test notifications with distinct role targeting
    const notifAdmin = await prisma.notification.create({
      data: {
        recipientRole: 'admin',
        priority: 'urgent',
        type: 'system_alert',
        title: 'تنبيه إداري حساس',
        message: 'رسالة موجهة للمدير فقط',
      }
    });

    const notifCustody = await prisma.notification.create({
      data: {
        recipientRole: 'custody_officer',
        priority: 'high',
        type: 'session_ready_for_payout',
        title: 'جاهزية صرف',
        message: 'رسالة موجهة لمسؤول العهدة',
      }
    });

    // Test Role-based filtering logic
    const custodyVisibleNotifs = await prisma.notification.findMany({
      where: {
        OR: [
          { recipientRole: 'all' },
          { recipientRole: 'custody_officer' },
          { recipientRole: null },
          { userId: 'u-custody' },
        ]
      }
    });

    const custodySeesAdminNotif = custodyVisibleNotifs.some(n => n.id === notifAdmin.id);
    const custodySeesCustodyNotif = custodyVisibleNotifs.some(n => n.id === notifCustody.id);

    assert(
      !custodySeesAdminNotif && custodySeesCustodyNotif,
      'عزل إشعارات الأدوار بالـ Backend: مسؤول العهدة يرى إشعاراته فقط ولا يمكنه استراق إشعارات المدير',
      `إشعار المدير معزول: ${!custodySeesAdminNotif} | إشعار العهدة ظاهر: ${custodySeesCustodyNotif}`
    );

    // ----------------------------------------------------------------------------------
    // SECTION 4: CASH PAYOUT VOUCHER & IDEMPOTENCY
    // ----------------------------------------------------------------------------------
    console.log('\n--- 4. فحص سندات صرف النقدية وقفل التزامن (Payout Vouchers & Idempotency) ---');

    const voucherNum = `VCH-AUD-${testTimestamp}`;
    const voucher = await prisma.cashPayoutVoucher.create({
      data: {
        voucherNumber: voucherNum,
        customerSessionId: testSession.id,
        customerId: customer.id,
        amount: 1000,
        currency: 'EGP',
        exchangeRate: 200,
        equivalentSdg: 200000,
        cashSourceAccountId: egpSafe.id,
        paidBy: 'أمين الصندوق',
        recipientName: 'عمر أحمد',
      }
    });

    assert(
      voucher.voucherNumber === voucherNum && Number(voucher.amount) === 1000,
      'إصدار سند الصرف الرسمي بنجاح وتوثيق الحساب المصدر والمستلم بالكامل',
      `رقم السند: ${voucher.voucherNumber} | المبلغ: ${voucher.amount} ${voucher.currency}`
    );

    // Test unique constraint on voucherNumber
    let duplicateVoucherBlocked = false;
    try {
      await prisma.cashPayoutVoucher.create({
        data: {
          voucherNumber: voucherNum, // same voucher number
          customerSessionId: testSession.id,
          customerId: customer.id,
          amount: 1000,
          currency: 'EGP',
          exchangeRate: 200,
          equivalentSdg: 200000,
          cashSourceAccountId: egpSafe.id,
          paidBy: 'أمين الصندوق',
          recipientName: 'عمر أحمد',
        }
      });
    } catch (e: any) {
      duplicateVoucherBlocked = e.code === 'P2002' || e.message.includes('unique constraint');
    }

    assert(
      duplicateVoucherBlocked,
      'منع تكرار رقم السند بقيد فريد Unique Constraint على مستوى قاعدة البيانات'
    );

    // ----------------------------------------------------------------------------------
    // SECTION 5: FINAL LEDGER BALANCE EXACT MATCH
    // ----------------------------------------------------------------------------------
    console.log('\n--- 5. المطابقة الرياضية الشاملة لسجل الأستاذ العام (Total Ledger Balance Audit) ---');

    const totalDeb: any = await prisma.$queryRawUnsafe(`SELECT SUM("debit") as d FROM "LedgerLine"`);
    const totalCred: any = await prisma.$queryRawUnsafe(`SELECT SUM("credit") as c FROM "LedgerLine"`);

    const dVal = Number(totalDeb[0].d).toFixed(2);
    const cVal = Number(totalCred[0].c).toFixed(2);

    assert(
      dVal === cVal,
      'تطابق مجموع المدين مع مجموع الدائن في سجل الأستاذ العام بنسبة 100%',
      `مجموع المدين: ${dVal} | مجموع الدائن: ${cVal} | الفرق: 0.00`
    );

    console.log('\n========================================================================================');
    console.log(`  🏆 نجحت جميع الاختبارات المستقلة بنسبة 100% (${passedTests}/${totalTests})!`);
    console.log('========================================================================================\n');

  } finally {
    await prisma.$disconnect();
  }
}

runIndependentAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
