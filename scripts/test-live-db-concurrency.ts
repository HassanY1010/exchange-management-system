import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import assert from 'assert';
import { calculateSessionBalance } from '../lib/financial-core/index';

const prisma = new PrismaClient();

async function runLiveDbConcurrencyTest() {
  console.log('========================================================================');
  console.log('  اختبار التزامن الفعلي على قاعدة البيانات (PostgreSQL Live Concurrency)  ');
  console.log('  التحقق من: Row-Level Locks (FOR UPDATE), Idempotency, Race Conditions  ');
  console.log('========================================================================\n');

  const testCustomerCode = `TEST-CONC-${Date.now()}`;
  const testSessionNumber = `SES-CONC-${Date.now()}`;

  let customerId = '';
  let sessionId = '';
  const receiptIds: string[] = [];

  try {
    // 1. Create isolated test customer in database
    console.log('1. إنشاء عميل اختبار معزول في قاعدة البيانات...');
    const testCustomer = await prisma.customer.create({
      data: {
        customerCode: testCustomerCode,
        name: 'عميل اختبار التزامن الحي',
        phone: '+201000000999',
        status: 'active',
      },
    });
    customerId = testCustomer.id;
    console.log(`✓ تم إنشاء العميل: ${testCustomer.name} (${testCustomer.id})`);

    // 2. Create test CustomerSession
    console.log('2. إنشاء جلسة حسابية للعميل بمبلغ 20,000,000 سوداني ومقابل 100,000 مصري...');
    const testSession = await prisma.customerSession.create({
      data: {
        sessionNumber: testSessionNumber,
        customerId,
        businessDate: new Date().toISOString().split('T')[0],
        currencyFrom: 'SDG',
        currencyTo: 'EGP',
        exchangeRate: '200.0000',
        expectedAmount: '20000000.0000',
        requestedAmount: '100000.0000',
        receivedAmount: '0.0000',
        deliveredAmount: '0.0000',
        remainingAmount: '20000000.0000',
        overpaymentAmount: '0.0000',
        status: 'open',
        createdBy: 'test_runner',
      },
    });
    sessionId = testSession.id;
    console.log(`✓ تم إنشاء الجلسة: ${testSession.sessionNumber} (${testSession.id})`);

    // 3. Create 5 test receipts of 4,000,000 SDG each
    console.log('3. إنشاء 5 إيصالات بنكك مرتبطة بالجلسة (4 مليون سوداني لكل إيصال)...');
    for (let i = 1; i <= 5; i++) {
      const r = await prisma.bankakReceipt.create({
        data: {
          receiptNumber: `RCP-CONC-${Date.now()}-${i}`,
          transactionId: `TX-CONC-${Date.now()}-${i}`,
          customerId,
          customerSessionId: sessionId,
          amount: '4000000.0000',
          currency: 'SDG',
          senderName: 'عميل اختبار التزامن الحي',
          receiverName: 'حساب بنكك الشركة',
          bankName: 'بنكك - بنك الخرطوم',
          imageStorageKey: `test-key-${i}`,
          imageHash: `hash-test-${Date.now()}-${i}`,
          status: 'verified',
          verifiedBy: 'system_verifier',
          verifiedAt: new Date(),
          createdBy: 'test_runner',
        },
      });
      receiptIds.push(r.id);
    }
    console.log(`✓ تم إنشاء 5 إيصالات بنجاح في قاعدة البيانات.`);

    // 4. Concurrently execute approvals using real DB transactions and SELECT ... FOR UPDATE
    console.log('\n4. إطلاق 5 عمليات اعتماد متزامنة في نفس اللحظة عبر Promise.all (Live DB Transactions)...');
    
    // Function that mirrors app/api/v1/receipts/[id]/approve/route.ts transactional logic
    const approveReceiptDbTx = async (receiptId: string, approverName: string) => {
      return await prisma.$transaction(
        async (tx) => {
        // Lock Receipt row
        const lockedReceiptRows = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "status", "customerId", "customerSessionId", "amount", "senderName", "receiverName", "transactionId", "verifiedBy" FROM "BankakReceipt" WHERE id = $1 FOR UPDATE',
          receiptId
        );
        if (!lockedReceiptRows || lockedReceiptRows.length === 0) {
          throw new Error('الإيصال غير موجود');
        }
        const lockedReceipt = lockedReceiptRows[0];
        if (lockedReceipt.status === 'approved') {
          throw new Error('تم اعتماد هذا الإيصال مسبقاً ولا يمكن اعتماده مرتين (Idempotency Guard)');
        }

        // Lock CustomerSession row (Crucial: prevents race conditions between concurrent approvals)
        let currentSession: any = null;
        if (lockedReceipt.customerSessionId) {
          const lockedSessions = await tx.$queryRawUnsafe<any[]>(
            'SELECT id, "status", "requestedAmount", "receivedAmount", "deliveredAmount", "exchangeRate", "overpaymentSettled", "sessionNumber", "businessDate" FROM "CustomerSession" WHERE id = $1 FOR UPDATE',
            lockedReceipt.customerSessionId
          );
          if (lockedSessions && lockedSessions.length > 0) {
            currentSession = lockedSessions[0];
          }
        }

        // Mark receipt as approved
        await tx.bankakReceipt.update({
          where: { id: receiptId },
          data: {
            status: 'approved',
            approvedBy: approverName,
            approvedAt: new Date(),
          },
        });

        // Query the true mathematical sum of all approved receipts inside tx
        if (currentSession) {
          const sumResult = await tx.$queryRawUnsafe<any[]>(
            'SELECT COALESCE(SUM("amount"), 0) as total FROM "BankakReceipt" WHERE "customerSessionId" = $1 AND "status" = \'approved\'',
            currentSession.id
          );
          const newReceivedTotal = Number(sumResult[0]?.total || 0);

          const balanceCheckResult = calculateSessionBalance({
            requestedEgpAmount: Number(currentSession.requestedAmount),
            exchangeRate: Number(currentSession.exchangeRate),
            approvedReceiptsTotalSdg: newReceivedTotal,
            deliveredEgpAmount: Number(currentSession.deliveredAmount),
            overpaymentSettled: currentSession.overpaymentSettled,
          });

          await tx.customerSession.update({
            where: { id: currentSession.id },
            data: {
              receivedAmount: balanceCheckResult.receivedSdgAmount,
              remainingAmount: balanceCheckResult.remainingSdgAmount,
              overpaymentAmount: balanceCheckResult.overpaymentAmount,
              status: balanceCheckResult.status,
            },
          });
        }

        return { success: true, receiptId };
      },
      {
        timeout: 25000,
        maxWait: 20000,
      });
    };

    // Launch all 5 approvals concurrently + 1 concurrent duplicate of receipt #1
    const concurrentPromises = [
      approveReceiptDbTx(receiptIds[0], 'Approver_1').catch((err) => ({ success: false, error: err.message, receiptId: receiptIds[0] })),
      approveReceiptDbTx(receiptIds[1], 'Approver_2').catch((err) => ({ success: false, error: err.message, receiptId: receiptIds[1] })),
      approveReceiptDbTx(receiptIds[2], 'Approver_3').catch((err) => ({ success: false, error: err.message, receiptId: receiptIds[2] })),
      approveReceiptDbTx(receiptIds[3], 'Approver_4').catch((err) => ({ success: false, error: err.message, receiptId: receiptIds[3] })),
      approveReceiptDbTx(receiptIds[4], 'Approver_5').catch((err) => ({ success: false, error: err.message, receiptId: receiptIds[4] })),
      // Concurrent duplicate attempt on receipt 1 (must be blocked by idempotency lock)
      approveReceiptDbTx(receiptIds[0], 'Approver_Duplicate').catch((err) => ({
        success: false,
        error: err.message,
        receiptId: receiptIds[0],
      })),
    ];

    const results = await Promise.all(concurrentPromises);
    console.log('✓ اكتملت كافة المعاملات المتزامنة.');

    // 5. Assertions on Database state
    console.log('\n5. التحقق من سلامة البيانات في قاعدة البيانات بعد التزامن:');
    
    // Check results summary
    const successful = results.filter((r) => r.success);
    const rejected = results.filter((r) => !r.success);
    console.log(`- عدد المعاملات الناجحة: ${successful.length} من 5 إيصالات أصلية.`);
    console.log(`- عدد المعاملات المرفوضة (المكررة): ${rejected.length}.`);
    assert.strictEqual(successful.length, 5, 'يجب أن تنجح 5 معاملات اعتماد للإيصالات الخمسة المختلفة');
    assert.strictEqual(rejected.length, 1, 'يجب رفض المحاولة المكررة للاعتماد');
    assert.match(rejected[0].error, /لا يمكن اعتماده مرتين/, 'رسالة الرفض تؤكد منع الاعتماد المزدوج');
    console.log('✓ تم منع التكرار (Idempotency) بنجاح أثناء التزامن.');

    // Fetch the final session from the live DB
    const finalSession = await prisma.customerSession.findUnique({
      where: { id: sessionId },
    });
    assert.ok(finalSession, 'الجلسة يجب أن تكون موجودة');
    console.log(`- رصيد الجلسة المستلم الفعلي (receivedAmount): ${finalSession.receivedAmount} SDG`);
    console.log(`- رصيد الجلسة المتبقي الفعلي (remainingAmount): ${finalSession.remainingAmount} SDG`);
    console.log(`- حالة الجلسة الحسابية (status): ${finalSession.status}`);

    const finalReceivedD = new Decimal(finalSession.receivedAmount.toString());
    const expectedReceivedD = new Decimal('20000000.0000');
    assert.strictEqual(
      finalReceivedD.toFixed(4),
      expectedReceivedD.toFixed(4),
      'المبلغ المستلم في قاعدة البيانات يجب أن يساوي 20,000,000 سوداني تماماً دون أي فقد أو تكرار'
    );
    assert.strictEqual(
      Number(finalSession.remainingAmount),
      0,
      'المبلغ المتبقي يجب أن يكون صفراً'
    );
    assert.strictEqual(
      finalSession.status,
      'pending_delivery',
      'حالة الجلسة بعد اكتمال الإيصالات يجب أن تتحول إلى pending_delivery'
    );
    console.log('✓ التحقق الرياضي والمحاسبي في قاعدة البيانات مطابق 100%: 20,000,000 سوداني!');

    // Fetch receipts from DB
    const finalReceipts = await prisma.bankakReceipt.findMany({
      where: { customerSessionId: sessionId },
    });
    assert.strictEqual(finalReceipts.length, 5);
    for (const fr of finalReceipts) {
      assert.strictEqual(fr.status, 'approved', `الإيصال ${fr.receiptNumber} يجب أن تكون حالته approved`);
    }
    console.log('✓ كافة الإيصالات الخمسة مسجلة كـ approved في قاعدة البيانات.');

    console.log('\n========================================================================');
    console.log('  نجح اختبار التزامن الفعلي على قاعدة البيانات بنسبة 100% (Zero Race Conditions)  ');
    console.log('========================================================================\n');
  } finally {
    // 6. Cleanup all test records to ensure ZERO pollution of database
    console.log('6. تنظيف سجلات الاختبار المعزولة من قاعدة البيانات...');
    if (receiptIds.length > 0) {
      await prisma.bankakReceipt.deleteMany({
        where: { id: { in: receiptIds } },
      });
      console.log(`✓ تم حذف إيصالات الاختبار (${receiptIds.length}).`);
    }
    if (sessionId) {
      await prisma.customerSession.delete({
        where: { id: sessionId },
      });
      console.log(`✓ تم حذف الجلسة التجريبية.`);
    }
    if (customerId) {
      await prisma.customer.delete({
        where: { id: customerId },
      });
      console.log(`✓ تم حذف العميل التجريبي.`);
    }
    console.log('✓ اكتمل التنظيف الشامل، وقاعدة البيانات نظيفة تماماً دون أي مساس ببيانات الإنتاج.');
    await prisma.$disconnect();
  }
}

runLiveDbConcurrencyTest().catch((err) => {
  console.error('فشل في اختبار التزامن على قاعدة البيانات:', err);
  process.exit(1);
});
