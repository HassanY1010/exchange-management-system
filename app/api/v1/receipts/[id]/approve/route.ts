import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { calculateSessionBalance } from '@/lib/financial-core';
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

    // Atomic row-level lock and idempotency check
    const receipt = await prisma.$transaction(async (tx) => {
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

      await tx.bankakReceipt.update({
        where: { id: params.id },
        data: updateData,
      });

      return await tx.bankakReceipt.findUnique({
        where: { id: params.id },
        include: { customer: true, customerSession: true },
      });
    });

    if (!receipt) {
      return NextResponse.json({ error: 'الإيصال غير موجود' }, { status: 404 });
    }

    // Find accounts (prefer SDG customer liability account 2015, fallback to 2010)
    const bankakAccount = await prisma.account.findFirst({
      where: { accountCode: '1030' },
    });
    const customerLiabilityAccount = await prisma.account.findFirst({
      where: { accountCode: '2015' },
    }) || await prisma.account.findFirst({
      where: { accountCode: '2010' },
    });

    if (!bankakAccount || !customerLiabilityAccount) {
      throw new Error('حساب بنكك أو حساب وسيط العملاء غير مهيأ في دليل الحسابات');
    }

    const receiptAmount = Number(receipt.amount);

    // 1. Post Double-Entry Ledger Transaction
    await postLedgerTransaction({
      entryType: 'bankak_receipt',
      referenceType: 'BankakReceipt',
      referenceId: receipt.id,
      description: `استلام إشعار بنكك رقم ${receipt.transactionId} بمبلغ ${receiptAmount.toLocaleString()} SDG للعميل ${receipt.customer?.name || 'عام'}`,
      createdBy: user.name,
      lines: [
        {
          accountId: bankakAccount.id,
          currency: 'SDG',
          debit: receiptAmount,
          credit: 0,
          description: `إيداع بنكك - إشعار ${receipt.transactionId}`,
        },
        {
          accountId: customerLiabilityAccount.id,
          currency: 'SDG',
          debit: 0,
          credit: receiptAmount,
          description: `استحقاق العميل ${receipt.customer?.name || ''}`,
        },
      ],
    });

    // 2. Update Customer Session if linked
    if (receipt.customerSessionId && receipt.customerSession) {
      const currentSession = receipt.customerSession;
      const newReceivedTotal = Number(currentSession.receivedAmount) + receiptAmount;

      const balanceCheck = calculateSessionBalance({
        requestedEgpAmount: Number(currentSession.requestedAmount),
        exchangeRate: Number(currentSession.exchangeRate),
        approvedReceiptsTotalSdg: newReceivedTotal,
        deliveredEgpAmount: Number(currentSession.deliveredAmount),
      });

      await prisma.customerSession.update({
        where: { id: currentSession.id },
        data: {
          receivedAmount: balanceCheck.receivedSdgAmount,
          remainingAmount: balanceCheck.remainingSdgAmount,
          overpaymentAmount: balanceCheck.overpaymentAmount,
          status: balanceCheck.status,
        },
      });

      // Dispatched alerts for Session Ready for Payout or Overpayment
      if (balanceCheck.isOverpaid) {
        await createNotification({
          type: 'overpayment_detected',
          title: 'تنبيه: فائض سداد للعميل (Overpayment)',
          message: `جلسة العميل ${receipt.customer?.name || ''} تحتوي على فائض بمبلغ ${balanceCheck.overpaymentAmount.toLocaleString()} SDG يتطلب تسوية أو ترحيل`,
          referenceType: 'CustomerSession',
          referenceId: currentSession.id,
          recipientRole: 'accountant',
          priority: 'high',
        });
      }

      if (balanceCheck.status === 'pending_delivery') {
        await createNotification({
          type: 'session_ready_for_payout',
          title: 'جلسة العميل جاهزة للصرف النقدي (Ready for Payout)',
          message: `اكتمل استيفاء مبالغ بنكك لجلسة ${currentSession.sessionNumber} للعميل ${receipt.customer?.name || ''}. المبلغ المستحق للصرف: ${Number(currentSession.requestedAmount).toLocaleString()} EGP`,
          referenceType: 'CustomerSession',
          referenceId: currentSession.id,
          recipientRole: 'custody_officer',
          priority: 'high',
        });
      }
    }

    // 3. Dispatch receipt approved notification
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
      oldValues: { status: receipt.status },
      newValues: { status: 'approved', amount: receipt.amount },
      reason: `اعتماد إيصال بنكك رقم ${receipt.transactionId}`,
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
