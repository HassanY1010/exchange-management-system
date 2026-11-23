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

  const allowedRoles = ['admin', 'accountant', 'data_entry', 'bankak_auditor'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية رفض الإيصالات مقتصرة على المحاسب أو مدخل البيانات المخول أو مدقق بنكك أو مدير النظام' }, { status: 403 });
  }

  try {
    const { reason } = await req.json();

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'سبب رفض الإيصال إلزامي ويجب تحديده بوضوح للتوثيق والرقابة' }, { status: 400 });
    }

    const { receipt, oldStatus } = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "status", "transactionId", "customerId" FROM "BankakReceipt" WHERE id = $1 FOR UPDATE',
        params.id
      );

      if (!locked || locked.length === 0) {
        throw new Error('الإيصال غير موجود');
      }

      if (locked[0].status === 'approved') {
        throw new Error('لا يمكن رفض إيصال تم اعتماده مالياً بالفعل. لإلغاء أثره يجب عمل قيد تسوية عكسي');
      }

      if (locked[0].status === 'rejected') {
        throw new Error('تم رفض هذا الإيصال مسبقاً ولا يمكن رفضه مجدداً');
      }

      const updated = await tx.bankakReceipt.update({
        where: { id: params.id },
        data: {
          status: 'rejected',
          reviewedBy: user.name,
          suspicionReason: reason.trim(),
        },
        include: { customer: true },
      });

      // Record Audit Log inside the same atomic transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'REJECT_BANKAK_RECEIPT',
        entityType: 'BankakReceipt',
        entityId: updated.id,
        oldValues: { status: locked[0].status },
        newValues: { status: 'rejected', reason: reason.trim() },
        reason: `رفض الإيصال رقم ${updated.transactionId}: ${reason.trim()}`,
        status: 'FAILED',
        tx,
      });

      return { receipt: updated, oldStatus: locked[0].status };
    }, { maxWait: 15000, timeout: 30000 });

    await createNotification({
      type: 'receipt_rejected',
      title: 'تم رفض إيصال بنكك',
      message: `تم رفض الإيصال رقم ${receipt.transactionId} للعميل ${receipt.customer?.name || 'عام'}. السبب: ${reason.trim()}`,
      referenceType: 'BankakReceipt',
      referenceId: receipt.id,
      recipientRole: 'data_entry',
      priority: 'normal',
    });

    return NextResponse.json({ success: true, message: 'تم رفض الإيصال وتوثيق السبب بنجاح', data: receipt });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في رفض الإيصال' }, { status: 400 });
  }
}
