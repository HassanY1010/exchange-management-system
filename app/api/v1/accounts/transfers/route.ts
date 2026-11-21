import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { fromAccountId, toAccountId, amount, description } = await req.json();

    const transferAmount = Number(amount);
    if (!fromAccountId || !toAccountId || !transferAmount || transferAmount <= 0) {
      return NextResponse.json({ error: 'الحساب المحول منه وإليه والمبلغ مطلوبان' }, { status: 400 });
    }

    if (fromAccountId === toAccountId) {
      return NextResponse.json({ error: 'لا يمكن التحويل لنفس الحساب' }, { status: 400 });
    }

    const fromAcc = await prisma.account.findUnique({ where: { id: fromAccountId } });
    const toAcc = await prisma.account.findUnique({ where: { id: toAccountId } });

    if (!fromAcc || !toAcc) {
      return NextResponse.json({ error: 'أحد الحسابات غير موجود' }, { status: 404 });
    }

    if (fromAcc.currency !== toAcc.currency) {
      return NextResponse.json({ error: 'التحويل المباشر يجب أن يكون بين حسابات تحمل نفس العملة' }, { status: 400 });
    }

    const currentBal = Number(fromAcc.currentBalance);
    if (currentBal < transferAmount) {
      return NextResponse.json({
        error: `رصيد الحساب المصدر (${currentBal.toLocaleString()} ${fromAcc.currency}) غير كافٍ للتحويل`,
      }, { status: 400 });
    }

    // Execute double-entry transfer
    const ledgerEntry = await postLedgerTransaction({
      entryType: 'fund_transfer',
      description: description || `تحويل مالي من ${fromAcc.name} إلى ${toAcc.name}`,
      createdBy: user.name,
      lines: [
        {
          accountId: toAcc.id,
          currency: toAcc.currency,
          debit: transferAmount,
          credit: 0,
          description: `إيداع محول من ${fromAcc.name}`,
        },
        {
          accountId: fromAcc.id,
          currency: fromAcc.currency,
          debit: 0,
          credit: transferAmount,
          description: `خصم تحويل إلى ${toAcc.name}`,
        },
      ],
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'FUND_TRANSFER',
      entityType: 'Account',
      entityId: fromAcc.id,
      newValues: { from: fromAcc.name, to: toAcc.name, amount: transferAmount, currency: fromAcc.currency },
      reason: description || 'تحويل مالي بين الحسابات',
    });

    return NextResponse.json({ success: true, message: 'تم التحويل المالي بنجاح', data: ledgerEntry });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في التحويل المالي' }, { status: 500 });
  }
}
