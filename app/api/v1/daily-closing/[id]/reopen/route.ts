import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحية إعادة فتح اليوم مخصصة لمدير النظام فقط' }, { status: 403 });
  }

  try {
    const { reason } = await req.json();
    if (!reason || reason.trim().length < 5) {
      return NextResponse.json({ error: 'يجب تقديم سبب تفصيلي لإعادة فتح اليوم المالي' }, { status: 400 });
    }

    const closing = await prisma.dailyClosing.findUnique({
      where: { id: params.id },
    });

    if (!closing) {
      return NextResponse.json({ error: 'سجل الإغلاق غير موجود' }, { status: 404 });
    }

    const updated = await prisma.dailyClosing.update({
      where: { id: params.id },
      data: {
        status: 'reopened',
        reopenedBy: user.name,
        reopenedAt: new Date(),
        notes: `${closing.notes || ''} [أعيد فتحه بواسطة ${user.name}: ${reason}]`,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'REOPEN_DAILY_CLOSING',
      entityType: 'DailyClosing',
      entityId: closing.id,
      oldValues: { status: 'closed' },
      newValues: { status: 'reopened' },
      reason: `إعادة فتح اليوم المالي ${closing.businessDate}: ${reason}`,
    });

    return NextResponse.json({
      success: true,
      message: 'تمت إعادة فتح اليوم المالي بنجاح وتسجيل السبب في سجل التدقيق',
      data: updated,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إعادة فتح اليوم' }, { status: 500 });
  }
}
