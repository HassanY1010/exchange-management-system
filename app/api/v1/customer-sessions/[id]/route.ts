import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { validateSessionClosure } from '@/lib/financial-core';
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
      vouchers: true,
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
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // RBAC: Only admin and accountant can close or cancel customer sessions
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية إغلاق أو إلغاء الجلسات الحسابية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'close'; // 'close' | 'cancel'

    const session = await prisma.customerSession.findUnique({
      where: { id: params.id },
      include: {
        customer: true,
        receipts: { where: { status: 'approved' } },
        vouchers: { where: { status: 'issued' } },
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 });
    }

    if (action === 'cancel') {
      // 1. Prohibit cancelling an already completed session
      if (session.status === 'completed') {
        return NextResponse.json({ error: 'لا يمكن إلغاء جلسة مكتملة ومغلقة محاسبياً' }, { status: 400 });
      }

      // 2. Prohibit cancelling a session that has approved financial receipts
      if (session.receipts && session.receipts.length > 0) {
        return NextResponse.json({
          error: `لا يمكن إلغاء الجلسة لاحتوائها على ${session.receipts.length} إيصالات بنكك معتمدة محاسبياً. يجب عكس أو تسوية الإيصالات أولاً`,
        }, { status: 400 });
      }

      // 3. Prohibit cancelling a session that has cash payouts delivered
      if (session.vouchers && session.vouchers.length > 0) {
        return NextResponse.json({
          error: `لا يمكن إلغاء الجلسة لاحتوائها على ${session.vouchers.length} سندات صرف نقدية منفذة فعلياً.`,
        }, { status: 400 });
      }

      const cancelled = await prisma.customerSession.update({
        where: { id: params.id },
        data: {
          status: 'cancelled',
          closedBy: user.name,
          closedAt: new Date(),
        },
      });

      await logAuditEvent({
        userId: user.userId,
        action: 'CANCEL_CUSTOMER_SESSION',
        entityType: 'CustomerSession',
        entityId: session.id,
        oldValues: { status: session.status },
        newValues: { status: 'cancelled' },
        reason: `إلغاء جلسة الحساب اليومية للعميل ${session.customer.name}`,
      });

      return NextResponse.json({ success: true, data: cancelled, message: 'تم إلغاء الجلسة بنجاح' });
    }

    // Default Action: 'close' (Complete Session)
    // Centralized financial closure validation
    const validation = validateSessionClosure({
      status: session.status,
      requestedAmount: session.requestedAmount,
      expectedAmount: session.expectedAmount,
      receivedAmount: session.receivedAmount,
      deliveredAmount: session.deliveredAmount,
      overpaymentAmount: session.overpaymentAmount,
      overpaymentSettled: session.overpaymentSettled,
    });

    if (!validation.canClose) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    // Ensure voucher exists if cash was delivered
    if (Number(session.deliveredAmount) > 0 && (!session.vouchers || session.vouchers.length === 0)) {
      return NextResponse.json({
        error: 'لا يمكن إغلاق الجلسة لعدم وجود سند صرف رسمي مسجل لمبلغ النقدية المسلّم',
      }, { status: 400 });
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

    return NextResponse.json({ success: true, data: updated, message: 'تم إغلاق الجلسة بنجاح' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إغلاق الجلسة' }, { status: 500 });
  }
}
