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

  try {
    const { reason } = await req.json();

    const receipt = await prisma.bankakReceipt.findUnique({
      where: { id: params.id },
    });

    if (!receipt) {
      return NextResponse.json({ error: 'الإيصال غير موجود' }, { status: 404 });
    }

    if (receipt.status === 'approved') {
      return NextResponse.json({ error: 'لا يمكن رفض إيصال تم اعتماده مالياً بالفعل' }, { status: 400 });
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
      newValues: { status: 'rejected' },
      reason: reason || 'تم رفض الإيصال بعد المراجعة',
    });

    return NextResponse.json({ success: true, message: 'تم رفض الإيصال', data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في رفض الإيصال' }, { status: 500 });
  }
}
