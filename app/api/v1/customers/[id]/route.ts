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

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      sessions: {
        where: { status: { not: 'cancelled' } },
        orderBy: { businessDate: 'desc' },
        include: {
          receipts: { where: { status: 'approved' } },
          vouchers: { where: { status: 'issued' } },
        },
      },
      receipts: {
        orderBy: { createdAt: 'desc' },
      },
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: 'العميل غير موجود', success: false }, { status: 404 });
  }

  // Calculate cumulative customer stats (active sessions only)
  const totalReceivedSdg = customer.sessions.reduce((sum, s) => sum + Number(s.receivedAmount || 0), 0);
  const totalDeliveredEgp = customer.sessions.reduce((sum, s) => sum + Number(s.deliveredAmount || 0), 0);
  const totalRequestedEgp = customer.sessions.reduce((sum, s) => sum + Number(s.requestedAmount || 0), 0);
  const totalRemainingSdg = customer.sessions.reduce((sum, s) => sum + Number(s.remainingAmount || 0), 0);
  const totalOverpaymentSdg = customer.sessions.reduce((sum, s) => sum + Number(s.overpaymentAmount || 0), 0);

  return NextResponse.json({
    success: true,
    data: {
      ...customer,
      totals: {
        totalReceivedSdg,
        totalDeliveredEgp,
        totalRequestedEgp,
        totalRemainingSdg,
        totalOverpaymentSdg,
      },
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC permission check for customer update
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية تعديل بيانات العميل مقتصرة على المحاسب أو مدير النظام فقط', success: false },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const existing = await prisma.customer.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: 'العميل غير موجود', success: false }, { status: 404 });
    }

    const updated = await prisma.customer.update({
      where: { id: params.id },
      data: {
        name: body.name ? body.name.trim() : existing.name,
        phone: body.phone ? body.phone.trim() : existing.phone,
        secondaryPhone: body.secondaryPhone !== undefined ? (body.secondaryPhone ? body.secondaryPhone.trim() : null) : existing.secondaryPhone,
        whatsapp: body.whatsapp !== undefined ? (body.whatsapp ? body.whatsapp.trim() : existing.phone) : existing.whatsapp,
        identityNumber: body.identityNumber !== undefined ? (body.identityNumber ? body.identityNumber.trim() : null) : existing.identityNumber,
        address: body.address !== undefined ? (body.address ? body.address.trim() : null) : existing.address,
        city: body.city !== undefined ? (body.city ? body.city.trim() : existing.city) : existing.city,
        notes: body.notes !== undefined ? (body.notes ? body.notes.trim() : null) : existing.notes,
        status: body.status ?? existing.status,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_CUSTOMER',
      entityType: 'Customer',
      entityId: updated.id,
      oldValues: {
        name: existing.name,
        phone: existing.phone,
        city: existing.city,
        status: existing.status,
      },
      newValues: {
        name: updated.name,
        phone: updated.phone,
        city: updated.city,
        status: updated.status,
      },
      reason: `تحديث بيانات العميل ${updated.name} بواسطة ${user.name} (${user.role})`,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تحديث بيانات العميل', success: false }, { status: 500 });
  }
}
