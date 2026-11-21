import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const debts = await prisma.debt.findMany({
    include: {
      payments: {
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: debts });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const {
      debtorType,
      debtorId,
      creditorType,
      creditorId,
      currency,
      originalAmount,
      dueDate,
      description,
    } = await req.json();

    const amount = Number(originalAmount);
    if (!debtorType || !debtorId || !currency || !amount || amount <= 0) {
      return NextResponse.json({ error: 'بيانات المدين والدائن والمبلغ والعملة مطلوبة' }, { status: 400 });
    }

    const count = await prisma.debt.count();
    const debtNumber = `DEBT-${Date.now()}-${count + 1}`;
    const debtDate = new Date().toISOString().split('T')[0];

    const debt = await prisma.debt.create({
      data: {
        debtNumber,
        debtorType,
        debtorId,
        creditorType: creditorType || 'office',
        creditorId: creditorId || 'office',
        currency,
        originalAmount: amount,
        remainingAmount: amount,
        debtDate,
        dueDate,
        description: description || 'تسجيل مديونية جديدة',
        status: 'outstanding',
        createdBy: user.name,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_DEBT',
      entityType: 'Debt',
      entityId: debt.id,
      newValues: debt,
      reason: `تسجيل مديونية بقيمة ${amount.toLocaleString()} ${currency}`,
    });

    return NextResponse.json({ success: true, data: debt }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تسجيل الدين' }, { status: 500 });
  }
}
