import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { getSystemBusinessDate } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { id } = params;
  if (!id) return NextResponse.json({ error: 'معرف الدين مطلوب' }, { status: 400 });

  const debt = await prisma.debt.findFirst({
    where: { OR: [{ id }, { debtNumber: id }] },
    include: {
      payments: {
        orderBy: { paymentDate: 'desc' },
      },
    },
  });

  if (!debt) {
    return NextResponse.json({ error: 'سجل الدين غير موجود' }, { status: 404 });
  }

  // Enrich payments with account names
  const accountIds = Array.from(new Set(debt.payments.map((p) => p.accountId)));
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, accountCode: true, name: true, currency: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  // Fetch associated ledger entries
  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: {
      OR: [
        { referenceType: 'Debt', referenceId: debt.debtNumber },
        { referenceType: 'DebtPayment', referenceId: debt.debtNumber },
      ],
    },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });

  const isReceivable = debt.creditorType === 'office';
  const partyName = isReceivable ? debt.debtorId : debt.creditorId;
  const partyType = isReceivable ? debt.debtorType : debt.creditorType;
  const orig = new Decimal(debt.originalAmount.toString());
  const rem = new Decimal(debt.remainingAmount.toString());
  const paid = orig.minus(rem);

  return NextResponse.json({
    success: true,
    data: {
      ...debt,
      originalAmount: orig.toNumber(),
      remainingAmount: rem.toNumber(),
      paidAmount: paid.toNumber(),
      isReceivable,
      isPayable: !isReceivable,
      partyName,
      partyType,
      payments: debt.payments.map((p) => ({
        ...p,
        amount: Number(p.amount),
        account: accountMap.get(p.accountId) || null,
      })),
      ledgerEntries,
    },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can cancel debts
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بإلغاء الديون. الصلاحية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  const { id } = params;
  if (!id) return NextResponse.json({ error: 'معرف الدين مطلوب' }, { status: 400 });

  let reason = '';
  try {
    const body = await req.json().catch(() => ({}));
    reason = body.reason || '';
  } catch {
    reason = '';
  }

  try {
    const debt = await prisma.debt.findFirst({
      where: { OR: [{ id }, { debtNumber: id }] },
      include: { payments: true },
    });

    if (!debt) {
      return NextResponse.json({ error: 'سجل الدين غير موجود' }, { status: 404 });
    }

    if (debt.status === 'cancelled') {
      return NextResponse.json({ error: 'هذا الدين ملغي مسبقاً' }, { status: 400 });
    }

    if (debt.payments.length > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن إلغاء الدين لاحتوائه على ${debt.payments.length} دفعات سداد مسجلة. يجب عكس أو إلغاء دفعات السداد أولاً`,
        },
        { status: 400 }
      );
    }

    const debtDateStr = getSystemBusinessDate(debt.createdAt);
    await assertBusinessDateOpen(debtDateStr);

    // Update status to cancelled
    const updatedDebt = await prisma.debt.update({
      where: { id: debt.id },
      data: {
        status: 'cancelled',
        description: `${debt.description} [ملغي: ${reason || 'بواسطة ' + (user.name || user.email)}]`,
      },
    });

    // Audit Log
    await logAuditEvent({
      userId: user.userId,
      action: 'CANCEL_DEBT',
      entityType: 'Debt',
      entityId: debt.id,
      oldValues: { status: debt.status, remainingAmount: Number(debt.remainingAmount) },
      newValues: { status: 'cancelled' },
      reason: reason || `إلغاء سجل الدين رقم ${debt.debtNumber}`,
    });

    return NextResponse.json({
      success: true,
      message: `تم إلغاء سجل الدين رقم ${debt.debtNumber} بنجاح`,
      data: updatedDebt,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ أثناء إلغاء الدين' }, { status: 500 });
  }
}
