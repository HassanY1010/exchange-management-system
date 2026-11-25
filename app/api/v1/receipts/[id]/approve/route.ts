import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import { approveBankakReceiptAtomic } from '@/lib/receipts/receipt-approval-service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية اعتماد الإيصالات المالية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { directVerification = false } = body;

    const { receipt } = await approveBankakReceiptAtomic({
      receiptId: params.id,
      userId: user.userId,
      userName: user.name,
      userRole: user.role,
      directVerification,
    });

    return NextResponse.json({
      success: true,
      message: 'تم اعتماد الإيصال وتسجيل الأثر المالي بنجاح',
      data: receipt,
    });
  } catch (error: any) {
    console.error('Error approving receipt:', error);
    const status = error.message?.includes('غير موجود') ? 404 : 400;
    return NextResponse.json({ error: error.message || 'خطأ في اعتماد الإيصال' }, { status });
  }
}
