import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

const PROTECTED_SYSTEM_CODES = ['1010', '1020', '1030', '1060', '1065', '2010', '2020', '3010', '4010', '5010'];

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const account = await prisma.account.findUnique({
    where: { id: params.id },
    include: {
      parentAccount: true,
      childAccounts: true,
      ledgerLines: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          ledgerEntry: true,
        },
      },
    },
  });

  if (!account) {
    return NextResponse.json({ error: 'الحساب المالي غير موجود' }, { status: 404 });
  }

  // Calculate total debits, credits, and ledger balance
  let sumDebit = new Decimal(0);
  let sumCredit = new Decimal(0);
  for (const line of account.ledgerLines) {
    sumDebit = sumDebit.plus(new Decimal(line.debit.toString()));
    sumCredit = sumCredit.plus(new Decimal(line.credit.toString()));
  }

  return NextResponse.json({
    success: true,
    data: {
      ...account,
      recentLedgerLines: account.ledgerLines,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية تعديل الصناديق والحسابات المالية مقتصرة على المدير والمحاسب' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { name, description, parentAccountId, status, accountCode, currency, accountType } = body;

    const existingAcc = await prisma.account.findUnique({
      where: { id: params.id },
      include: {
        _count: {
          select: { ledgerLines: true },
        },
      },
    });

    if (!existingAcc) {
      return NextResponse.json({ error: 'الحساب المالي غير موجود' }, { status: 404 });
    }

    const hasFinancialHistory = existingAcc._count.ledgerLines > 0;

    // Protection: Immutable fields once financial history exists
    if (hasFinancialHistory) {
      if (currency && currency.toUpperCase().trim() !== existingAcc.currency) {
        return NextResponse.json(
          { error: 'لا يمكن تعديل عملة الحساب نظراً لوجود قيود مالية تاريخية مرتبطة به' },
          { status: 400 }
        );
      }
      if (accountType && accountType !== existingAcc.accountType) {
        return NextResponse.json(
          { error: 'لا يمكن تعديل نوع الحساب المحاسبي نظراً لوجود قيود مالية تاريخية مسجلة به' },
          { status: 400 }
        );
      }
      if (accountCode && accountCode.trim() !== existingAcc.accountCode) {
        return NextResponse.json(
          { error: 'لا يمكن تعديل كود الحساب نظراً لوجود معاملات مالية مرتبطة به' },
          { status: 400 }
        );
      }
    }

    // Protection: System accounts cannot be deactivated
    if (status === 'inactive' && (existingAcc.isSystem || PROTECTED_SYSTEM_CODES.includes(existingAcc.accountCode))) {
      return NextResponse.json(
        { error: 'لا يمكن تعطيل الحسابات النظامية الأساسية للنظام' },
        { status: 400 }
      );
    }

    // Name uniqueness check if changed
    if (name && name.trim() !== existingAcc.name) {
      const duplicate = await prisma.account.findFirst({
        where: {
          name: name.trim(),
          currency: existingAcc.currency,
          id: { not: params.id },
        },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: `يوجد حساب آخر مسجل باسم (${name.trim()}) لنفس العملة (${existingAcc.currency})` },
          { status: 400 }
        );
      }
    }

    // Hierarchy circular check
    if (parentAccountId && parentAccountId === params.id) {
      return NextResponse.json({ error: 'لا يمكن تعيين الحساب كحساب أب لنفسه' }, { status: 400 });
    }

    const updated = await prisma.account.update({
      where: { id: params.id },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        description: description !== undefined ? description.trim() : undefined,
        parentAccountId: parentAccountId !== undefined ? parentAccountId || null : undefined,
        status: status !== undefined ? status : undefined,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_ACCOUNT',
      entityType: 'Account',
      entityId: params.id,
      oldValues: existingAcc,
      newValues: updated,
      reason: `تعديل بيانات الحساب/الصندوق المالي (${updated.name})`,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تعديل الحساب' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحية حذف الحسابات المالية مقتصرة على مدير النظام' }, { status: 403 });
  }

  try {
    const existingAcc = await prisma.account.findUnique({
      where: { id: params.id },
      include: {
        _count: {
          select: {
            ledgerLines: true,
            childAccounts: true,
          },
        },
      },
    });

    if (!existingAcc) {
      return NextResponse.json({ error: 'الحساب المالي غير موجود' }, { status: 404 });
    }

    // Rule 1: System Accounts cannot be deleted
    if (existingAcc.isSystem || PROTECTED_SYSTEM_CODES.includes(existingAcc.accountCode)) {
      return NextResponse.json(
        { error: 'لا يمكن حذف الحسابات النظامية الأساسية؛ يمكنك تعديل الاسم أو الوصف فقط' },
        { status: 400 }
      );
    }

    // Rule 2: Cannot delete account with ledger lines (financial history)
    if (existingAcc._count.ledgerLines > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف الحساب (${existingAcc.name}) نظراً لوجود (${existingAcc._count.ledgerLines}) معاملة مالية مسجلة به في دفتر اليومية. للحفاظ على نزاهة السجلات، يرجى تعطيل الحساب بدلاً من حذفه.`,
        },
        { status: 400 }
      );
    }

    // Rule 3: Cannot delete account with non-zero balance
    const dBalance = new Decimal(existingAcc.currentBalance.toString());
    if (!dBalance.isZero()) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف الحساب برصيد قائم (${dBalance.toFixed(2)} ${existingAcc.currency}). يرجى تصفير الرصيد أو تحويله أولاً`,
        },
        { status: 400 }
      );
    }

    // Rule 4: Cannot delete account with child accounts
    if (existingAcc._count.childAccounts > 0) {
      return NextResponse.json(
        { error: 'لا يمكن حذف حساب رئيسي مرتبط بحسابات فرعية تابعة له. يرجى نقل أو حذف الحسابات الفرعية أولاً' },
        { status: 400 }
      );
    }

    await prisma.account.delete({
      where: { id: params.id },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'DELETE_ACCOUNT',
      entityType: 'Account',
      entityId: params.id,
      oldValues: existingAcc,
      reason: `حذف الحساب المالي (${existingAcc.name} - ${existingAcc.accountCode})`,
    });

    return NextResponse.json({
      success: true,
      message: `تم حذف الحساب (${existingAcc.name}) بنجاح`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في حذف الحساب' }, { status: 500 });
  }
}
