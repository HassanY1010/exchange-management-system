import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant', 'data_entry'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية رفض الإيصالات مقتصرة على المحاسب أو مدخل البيانات المخول أو مدير النظام' }, { status: 403 });
  }

  try {
    const { reason } = await req.json();

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'سبب رفض الإيصال إلزامي ويجب تحديده بوضوح للتوثيق والرقابة' }, { status: 400 });
    }

    const receipt = await prisma.bankakReceipt.findUnique({
      where: { id: params.id },
      include: { customer: true },
    });

    if (!receipt) {
      return NextResponse.json({ error: 'الإيصال غير موجود' }, { status: 404 });
    }

    if (receipt.status === 'approved') {
      return NextResponse.json({ error: 'لا يمكن رفض إيصال تم اعتماده مالياً بالفعل. لإلغاء أثره يجب عمل قيد تسوية عكسي' }, { status: 400 });
    }

    const updated = await prisma.bankakReceipt.update({
      where: { id: params.id },
      data: {
        status: 'rejected',
        reviewedBy: user.name,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'REJECT_BANKAK_RECEIPT',
      entityType: 'BankakReceipt',
      entityId: receipt.id,
      oldValues: { status: receipt.status },
      newValues: { status: 'rejected', reason },
      reason: `رفض الإيصال رقم ${receipt.transactionId}: ${reason}`,
    });

    await createNotification({
      type: 'receipt_rejected',
      title: 'تم رفض إيصال بنكك',
      message: `تم رفض الإيصال رقم ${receipt.transactionId} للعميل ${receipt.customer?.name || 'عام'}. السبب: ${reason}`,
      referenceType: 'BankakReceipt',
      referenceId: receipt.id,
      recipientRole: 'data_entry',
      priority: 'normal',
    });

    return NextResponse.json({ success: true, message: 'تم رفض الإيصال وتوثيق السبب بنجاح', data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في رفض الإيصال' }, { status: 500 });
  }
}
