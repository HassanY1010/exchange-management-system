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
    return NextResponse.json({ error: 'صلاحية إعادة فتح اليوم المالي مخصصة لمدير النظام فقط' }, { status: 403 });
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: 'معرف سجل الإغلاق مطلوب' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { reason } = body;
    if (!reason || reason.trim().length < 5) {
      return NextResponse.json({ error: 'يجب تقديم سبب تفصيلي لإعادة فتح اليوم المالي (5 أحرف على الأقل)' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const closing = await tx.dailyClosing.findFirst({
        where: { OR: [{ id }, { businessDate: id }] },
      });

      if (!closing) {
        throw new Error('سجل الإغلاق غير موجود');
      }

      if (closing.status === 'reopened') {
        throw new Error(`اليوم المالي ${closing.businessDate} مفتوح بالفعل مسبقاً`);
      }

      const timestamp = new Date().toISOString();
      const updatedNotes = `${closing.notes || ''} [أعيد فتحه بواسطة ${user.name || user.email}: ${reason.trim()} في ${timestamp}]`;

      const updated = await tx.dailyClosing.update({
        where: { id: closing.id },
        data: {
          status: 'reopened',
          reopenedBy: user.name || user.email || user.userId,
          reopenedAt: new Date(),
          notes: updatedNotes,
        },
      });

      await logAuditEvent({
        userId: user.userId,
        action: 'REOPEN_DAILY_CLOSING',
        entityType: 'DailyClosing',
        entityId: closing.id,
        oldValues: { status: 'closed', closedAt: closing.closedAt },
        newValues: { status: 'reopened', reopenedAt: updated.reopenedAt, reason: reason.trim() },
        reason: `إعادة فتح اليوم المالي ${closing.businessDate}: ${reason.trim()}`,
        tx,
      });

      return updated;
    });

    return NextResponse.json({
      success: true,
      message: `تمت إعادة فتح اليوم المالي (${result.businessDate}) بنجاح وتوثيق السبب في سجل التدقيق`,
      data: result,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ أثناء إعادة فتح اليوم المالي' }, { status: 400 });
  }
}
