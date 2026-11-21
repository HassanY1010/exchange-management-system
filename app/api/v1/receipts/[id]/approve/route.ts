import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { calculateSessionBalance } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';

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
    // Atomic row-level lock and idempotency check
    const receipt = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "status", "amount", "transactionId", "customerId", "customerSessionId" FROM "BankakReceipt" WHERE id = $1 FOR UPDATE',
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

      await tx.bankakReceipt.update({
        where: { id: params.id },
        data: {
          status: 'approved',
          approvedBy: user.name,
          approvedAt: new Date(),
        },
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
          status: balanceCheck.status,
        },
      });
    }

    // 3. Receipt already marked approved inside atomic lock
    const updatedReceipt = receipt;

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
      data: updatedReceipt,
    });
  } catch (error: any) {
    console.error('Error approving receipt:', error);
    return NextResponse.json({ error: error.message || 'خطأ في اعتماد الإيصال' }, { status: 500 });
  }
}
