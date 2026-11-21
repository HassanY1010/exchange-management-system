import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const session = await prisma.customerSession.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      receipts: {
        orderBy: { createdAt: 'desc' },
      },
      transactions: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: session });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Close session action
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const session = await prisma.customerSession.findUnique({
      where: { id: params.id },
      include: { customer: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 });
    }

    const updated = await prisma.customerSession.update({
      where: { id: params.id },
      data: {
        status: 'completed',
        closedBy: user.name,
        closedAt: new Date(),
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CLOSE_CUSTOMER_SESSION',
      entityType: 'CustomerSession',
      entityId: session.id,
      oldValues: { status: session.status },
      newValues: { status: 'completed' },
      reason: `إغلاق جلسة الحساب اليومية للعميل ${session.customer.name}`,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إغلاق الجلسة' }, { status: 500 });
  }
}
