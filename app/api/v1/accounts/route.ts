import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const accounts = await prisma.account.findMany({
    orderBy: { accountCode: 'asc' },
    include: {
      ledgerLines: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  });

  return NextResponse.json({ success: true, data: accounts });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { name, accountType, currency, openingBalance } = await req.json();

    if (!name || !accountType || !currency) {
      return NextResponse.json({ error: 'الاسم ونوع الحساب والعملة مطلوبان' }, { status: 400 });
    }

    const count = await prisma.account.count();
    const accountCode = `ACC-${(1000 + count + 1).toString()}`;
    const initialBalance = Number(openingBalance || 0);

    const account = await prisma.account.create({
      data: {
        accountCode,
        name,
        accountType,
        currency,
        openingBalance: initialBalance,
        currentBalance: initialBalance,
        status: 'active',
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_ACCOUNT',
      entityType: 'Account',
      entityId: account.id,
      newValues: account,
      reason: 'إنشاء حساب أو صندوق مالي جديد',
    });

    return NextResponse.json({ success: true, data: account }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء الحساب' }, { status: 500 });
  }
}
