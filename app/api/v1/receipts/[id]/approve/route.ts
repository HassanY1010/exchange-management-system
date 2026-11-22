import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { calculateSessionBalance, getSystemBusinessDate } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية اعتماد الإيصالات المالية مقتصرة على المحاسب أو مدير النظام فقط' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { directVerification = false } = body;

    // Single fully atomic financial transaction
    const { receipt, balanceCheck, linkedSession } = await prisma.$transaction(async (tx) => {
      // 1. Atomic row-level lock and idempotency check
      const locked = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "status", "amount", "transactionId", "customerId", "customerSessionId", "verifiedBy" FROM "BankakReceipt" WHERE id = $1 FOR UPDATE',
        params.id
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

      // Prohibit approving receipt for a cancelled customer session
      let currentSession: any = null;
      if (locked[0].customerSessionId) {
        const lockedSessions = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "status", "requestedAmount", "receivedAmount", "deliveredAmount", "exchangeRate", "overpaymentSettled", "sessionNumber", "businessDate" FROM "CustomerSession" WHERE id = $1 FOR UPDATE',
          locked[0].customerSessionId
        );
        if (lockedSessions && lockedSessions.length > 0) {
          currentSession = lockedSessions[0];
          if (currentSession.status === 'cancelled') {
            throw new Error('لا يمكن اعتماد إيصال مالي لجلسة حسابية ملغاة');
          }
        }
      }

      // Assert that the business date is open and not frozen
      const receiptBusinessDate = currentSession?.businessDate || getSystemBusinessDate();
      await assertBusinessDateOpen(receiptBusinessDate, tx);

      // Enforce Verified State prior to Financial Approval (or Admin direct dual-verification)
      if (locked[0].status !== 'verified' && !directVerification && user.role !== 'admin') {
        throw new Error('لا يمكن الاعتماد المالي للإيصال قبل التحقق من وصول الأموال لحساب بنكك أولاً (يجب أن تكون حالة الإيصال Verified)');
      }

      const updateData: any = {
        status: 'approved',
        approvedBy: user.name,
        approvedAt: new Date(),
      };

      if (!locked[0].verifiedBy) {
        updateData.verifiedBy = user.name;
        updateData.verifiedAt = new Date();
        updateData.verificationSource = directVerification ? 'accountant_direct_approval' : 'admin_approval';
        updateData.verificationNotes = 'تم التحقق والاعتماد في خطوة واحدة بواسطة المسؤول المعتمد';
      }

      const updatedReceipt = await tx.bankakReceipt.update({
        where: { id: params.id },
        data: updateData,
        include: { customer: true, customerSession: true },
      });

      // Find accounts (prefer SDG customer liability account 2015, fallback to 2010)
      const bankakAccount = await tx.account.findFirst({
        where: { accountCode: '1030' },
      });
      const customerLiabilityAccount = await tx.account.findFirst({
        where: { accountCode: '2015' },
      }) || await tx.account.findFirst({
        where: { accountCode: '2010' },
      });

      if (!bankakAccount || !customerLiabilityAccount) {
        throw new Error('حساب بنكك أو حساب وسيط العملاء غير مهيأ في دليل الحسابات');
      }

      const receiptAmount = Number(updatedReceipt.amount);

      // Post Double-Entry Ledger Transaction INSIDE the same atomic transaction
      await postLedgerTransaction({
        entryType: 'bankak_receipt',
        referenceType: 'BankakReceipt',
        referenceId: updatedReceipt.id,
        entryDate: receiptBusinessDate,
        description: `استلام إشعار بنكك رقم ${updatedReceipt.transactionId} بمبلغ ${receiptAmount.toLocaleString()} SDG للعميل ${updatedReceipt.customer?.name || 'عام'}`,
        createdBy: user.name,
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
        // Query the true mathematical sum of all approved receipts inside tx to eliminate any race condition
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
            closedBy: balanceCheckResult.status === 'completed' ? user.name : null,
          },
        });
      }

      return {
        receipt: updatedReceipt,
        balanceCheck: balanceCheckResult,
        linkedSession: currentSession,
      };
    });

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

    // Receipt approved notification
    await createNotification({
      type: 'receipt_approved',
      title: 'تم اعتماد إيصال بنكك وتسجيل القيد المالي',
      message: `تم اعتماد إيصال بنكك رقم ${receipt.transactionId} بمبلغ ${receiptAmount.toLocaleString()} SDG بنجاح في الحسابات`,
      referenceType: 'BankakReceipt',
      referenceId: receipt.id,
      recipientRole: 'all',
      priority: 'normal',
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'APPROVE_BANKAK_RECEIPT',
      entityType: 'BankakReceipt',
      entityId: receipt.id,
      oldValues: { status: 'verified' },
      newValues: { status: 'approved', amount: receipt.amount },
      reason: `اعتماد إيصال بنكك رقم ${receipt.transactionId} وقيد اليومية المحاسبي`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم اعتماد الإيصال وتسجيل الأثر المالي بنجاح',
      data: receipt,
    });
  } catch (error: any) {
    console.error('Error approving receipt:', error);
    return NextResponse.json({ error: error.message || 'خطأ في اعتماد الإيصال' }, { status: 500 });
  }
}
