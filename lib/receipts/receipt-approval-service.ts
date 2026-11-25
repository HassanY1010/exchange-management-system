import { prisma } from '@/lib/db';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { calculateSessionBalance, getSystemBusinessDate } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

export interface ApproveReceiptParams {
  receiptId: string;
  userId: string;
  userName: string;
  userRole: string;
  directVerification?: boolean;
  allowAutoApproval?: boolean;
  verificationSource?: string;
  verificationNotes?: string;
}

/**
 * Atomically verifies (if not already verified) and financially approves a BankakReceipt:
 * - Acquires FOR UPDATE row locks on BankakReceipt and linked CustomerSession
 * - Enforces anti-duplicate, non-zero amount, open business date, and active customer checks
 * - Posts Double-Entry Ledger Transaction (1030 Bankak Debit / 2015 Customer Liability Credit)
 * - Recalculates CustomerSession balances & status
 * - Logs AuditLog and dispatches notifications
 */
export async function approveBankakReceiptAtomic(params: ApproveReceiptParams) {
  const {
    receiptId,
    userId,
    userName,
    userRole,
    directVerification = false,
    allowAutoApproval = false,
    verificationSource,
    verificationNotes,
  } = params;

  const { receipt, balanceCheck, linkedSession } = await prisma.$transaction(
    async (tx) => {
      // 1. Atomic row-level lock and idempotency check
      const locked = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "status", "amount", "transactionId", "customerId", "customerSessionId", "verifiedBy" FROM "BankakReceipt" WHERE id = $1 FOR UPDATE',
        receiptId
      );
      if (!locked || locked.length === 0) {
        throw new Error('الإيصال غير موجود');
      }
      if (locked[0].status === 'approved') {
        throw new Error('تم اعتماد هذا الإيصال مسبقاً ولا يمكن اعتماده مرتين');
      }
      if (locked[0].status === 'duplicate') {
        throw new Error('لا يمكن اعتماد إيصال مكرر مسجل في النظام');
      }
      if (locked[0].status === 'rejected') {
        throw new Error('لا يمكن اعتماد إيصال تم رفضه مسبقاً');
      }
      if (!locked[0].amount || Number(locked[0].amount) <= 0) {
        throw new Error(
          'لا يمكن الاعتماد المالي لإيصال بمبلغ صفري أو غير محدد. يرجى مراجعة وتعديل المبلغ الفعلي أولاً.'
        );
      }

      // Prohibit approving receipt for a cancelled customer session or closed customer
      let currentSession: any = null;
      if (locked[0].customerSessionId) {
        const lockedSessions = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "status", "requestedAmount", "receivedAmount", "deliveredAmount", "exchangeRate", "overpaymentSettled", "sessionNumber", "businessDate", "customerId" FROM "CustomerSession" WHERE id = $1 FOR UPDATE',
          locked[0].customerSessionId
        );
        if (lockedSessions && lockedSessions.length > 0) {
          currentSession = lockedSessions[0];
          if (currentSession.status === 'cancelled') {
            throw new Error('لا يمكن اعتماد إيصال مالي لجلسة حسابية ملغاة');
          }
        }
      }

      const effectiveCustomerId = locked[0].customerId || currentSession?.customerId;
      if (effectiveCustomerId) {
        const cust = await tx.customer.findUnique({
          where: { id: effectiveCustomerId },
          select: { status: true, name: true },
        });
        if (cust?.status === 'closed') {
          throw new Error(`حساب العميل (${cust.name}) مقفل حالياً. لا يمكن اعتماد إيصالات مالية لحساب مقفل.`);
        }
        if (cust?.status === 'blocked') {
          throw new Error(`حساب العميل (${cust.name}) محظور في النظام.`);
        }
      }

      // Assert that the business date is open and not frozen
      const receiptBusinessDate = currentSession?.businessDate || getSystemBusinessDate();
      await assertBusinessDateOpen(receiptBusinessDate, tx);

      // Enforce Verified State prior to Financial Approval (unless direct/auto/admin)
      if (
        locked[0].status !== 'verified' &&
        !directVerification &&
        !allowAutoApproval &&
        userRole !== 'admin'
      ) {
        throw new Error(
          'لا يمكن الاعتماد المالي للإيصال قبل التحقق من وصول الأموال لحساب بنكك أولاً (يجب أن تكون حالة الإيصال Verified)'
        );
      }

      // Segregation of Duties (SoD) check unless admin or explicit auto-approval workflow
      if (
        locked[0].verifiedBy &&
        locked[0].verifiedBy === userName &&
        userRole !== 'admin' &&
        !allowAutoApproval
      ) {
        throw new Error(
          `مخالفة لقواعد فصل الصلاحيات والمهام (Segregation of Duties): المستخدم الذي قام بالتحقق (${locked[0].verifiedBy}) لا يمكنه اعتماد الإيصال المالي وترحيله للدفاتر بنفسه. يجب الاعتماد بواسطة مستخدم مخول آخر.`
        );
      }

      const updateData: any = {
        status: 'approved',
        approvedBy: userName,
        approvedAt: new Date(),
      };

      if (!locked[0].verifiedBy) {
        updateData.verifiedBy = userName;
        updateData.verifiedAt = new Date();
        updateData.verificationSource =
          verificationSource ||
          (allowAutoApproval
            ? 'auto_upload_approval'
            : directVerification
            ? 'accountant_direct_approval'
            : 'admin_approval');
        updateData.verificationNotes =
          verificationNotes ||
          (allowAutoApproval
            ? 'تم التحقق البنكي والاعتماد المالي تلقائياً عند رفع الإيصال'
            : 'تم التحقق والاعتماد في خطوة واحدة بواسطة المسؤول المعتمد');
      }

      const updatedReceipt = await tx.bankakReceipt.update({
        where: { id: receiptId },
        data: updateData,
        include: { customer: true, customerSession: true },
      });

      // Find accounts (prefer SDG customer liability account 2015, fallback to 2010)
      const bankakAccount = await tx.account.findFirst({
        where: { accountCode: '1030' },
      });
      const customerLiabilityAccount =
        (await tx.account.findFirst({
          where: { accountCode: '2015' },
        })) ||
        (await tx.account.findFirst({
          where: { accountCode: '2010' },
        }));

      if (!bankakAccount || !customerLiabilityAccount) {
        throw new Error('حساب بنكك أو حساب وسيط العملاء غير مهيأ في دليل الحسابات');
      }

      const receiptAmount = Number(updatedReceipt.amount);
      if (!receiptAmount || isNaN(receiptAmount) || receiptAmount <= 0) {
        throw new Error('لا يمكن اعتماد إيصال بمبلغ صفري أو سالب');
      }

      if (updatedReceipt.currency !== 'SDG') {
        throw new Error(`عملة الإيصال غير مدعومة للاعتماد المالي: ${updatedReceipt.currency}`);
      }

      // Post Double-Entry Ledger Transaction INSIDE the same atomic transaction
      await postLedgerTransaction({
        entryType: 'bankak_receipt',
        referenceType: 'BankakReceipt',
        referenceId: updatedReceipt.id,
        entryDate: receiptBusinessDate,
        description: `استلام إشعار بنكك رقم ${updatedReceipt.transactionId} بمبلغ ${receiptAmount.toLocaleString()} SDG للعميل ${updatedReceipt.customer?.name || 'عام'}`,
        createdBy: userName,
        tx,
        lines: [
          {
            accountId: bankakAccount.id,
            currency: 'SDG',
            debit: receiptAmount,
            credit: 0,
            description: `إيداع بنكك - إشعار ${updatedReceipt.transactionId}`,
          },
          {
            accountId: customerLiabilityAccount.id,
            currency: 'SDG',
            debit: 0,
            credit: receiptAmount,
            description: `استحقاق العميل ${updatedReceipt.customer?.name || ''}`,
          },
        ],
      });

      // Update Customer Session balance atomically if linked
      let balanceCheckResult: any = null;
      if (currentSession) {
        const sumResult = await tx.$queryRawUnsafe<any[]>(
          'SELECT COALESCE(SUM("amount"), 0) as total FROM "BankakReceipt" WHERE "customerSessionId" = $1 AND "status" = \'approved\'',
          currentSession.id
        );
        const newReceivedTotal = Number(sumResult[0]?.total || 0);

        balanceCheckResult = calculateSessionBalance({
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
            closedAt: balanceCheckResult.status === 'completed' ? new Date() : null,
            closedBy: balanceCheckResult.status === 'completed' ? userName : null,
          },
        });
      }

      // Record Audit Log inside the same atomic transaction
      await logAuditEvent({
        userId,
        action: allowAutoApproval ? 'AUTO_VERIFY_AND_APPROVE_RECEIPT' : 'APPROVE_BANKAK_RECEIPT',
        entityType: 'BankakReceipt',
        entityId: updatedReceipt.id,
        oldValues: { status: locked[0].status },
        newValues: { status: 'approved', amount: updatedReceipt.amount, autoApproved: allowAutoApproval },
        reason: allowAutoApproval
          ? `تحقق بنكي واعتماد مالي تلقائي لإيصال بنكك رقم ${updatedReceipt.transactionId} عند الرفع`
          : `اعتماد إيصال بنكك رقم ${updatedReceipt.transactionId} وقيد اليومية المحاسبي`,
        tx,
      });

      return {
        receipt: updatedReceipt,
        balanceCheck: balanceCheckResult,
        linkedSession: currentSession,
      };
    },
    { maxWait: 20000, timeout: 45000 }
  );

  const receiptAmount = Number(receipt.amount);

  // Notifications and Alerts dispatched safely after transaction commit
  if (balanceCheck && linkedSession) {
    if (balanceCheck.isOverpaid) {
      await createNotification({
        type: 'overpayment_detected',
        title: 'تنبيه: فائض سداد للعميل (Overpayment)',
        message: `جلسة العميل ${receipt.customer?.name || ''} تحتوي على فائض بمبلغ ${balanceCheck.overpaymentAmount.toLocaleString()} SDG يتطلب تسوية أو ترحيل`,
        referenceType: 'CustomerSession',
        referenceId: linkedSession.id,
        recipientRole: 'accountant',
        priority: 'high',
      });
    }

    if (balanceCheck.status === 'pending_delivery') {
      await createNotification({
        type: 'session_ready_for_payout',
        title: 'جلسة العميل جاهزة للصرف النقدي (Ready for Payout)',
        message: `اكتمل استيفاء مبالغ بنكك لجلسة ${linkedSession.sessionNumber} للعميل ${receipt.customer?.name || ''}. المبلغ المستحق للصرف: ${Number(linkedSession.requestedAmount).toLocaleString()} EGP`,
        referenceType: 'CustomerSession',
        referenceId: linkedSession.id,
        recipientRole: 'custody_officer',
        priority: 'high',
      });
    }
  }

  await createNotification({
    type: 'receipt_approved',
    title: allowAutoApproval
      ? 'تم التحقق والاعتماد التلقائي لإيصال بنكك'
      : 'تم اعتماد إيصال بنكك وتسجيل القيد المالي',
    message: `تم اعتماد إيصال بنكك رقم ${receipt.transactionId} بمبلغ ${receiptAmount.toLocaleString()} SDG بنجاح في الحسابات`,
    referenceType: 'BankakReceipt',
    referenceId: receipt.id,
    recipientRole: 'all',
    priority: 'normal',
  });

  return { receipt, balanceCheck, linkedSession };
}
