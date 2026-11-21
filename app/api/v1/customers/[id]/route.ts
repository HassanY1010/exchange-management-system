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
        orderBy: { businessDate: 'desc' },
        include: {
          receipts: true,
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
    return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
  }

  // Calculate cumulative customer stats
  const totalReceivedSdg = customer.sessions.reduce((sum, s) => sum + Number(s.receivedAmount), 0);
  const totalDeliveredEgp = customer.sessions.reduce((sum, s) => sum + Number(s.deliveredAmount), 0);
  const totalRequestedEgp = customer.sessions.reduce((sum, s) => sum + Number(s.requestedAmount), 0);
  const totalRemainingSdg = customer.sessions.reduce((sum, s) => sum + Number(s.remainingAmount), 0);

  return NextResponse.json({
    success: true,
    data: {
      ...customer,
      totals: {
        totalReceivedSdg,
        totalDeliveredEgp,
        totalRequestedEgp,
        totalRemainingSdg,
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

  try {
    const body = await req.json();
    const existing = await prisma.customer.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
    }

    const updated = await prisma.customer.update({
      where: { id: params.id },
      data: {
        name: body.name ?? existing.name,
        phone: body.phone ?? existing.phone,
        secondaryPhone: body.secondaryPhone ?? existing.secondaryPhone,
        whatsapp: body.whatsapp ?? existing.whatsapp,
        identityNumber: body.identityNumber ?? existing.identityNumber,
        address: body.address ?? existing.address,
        city: body.city ?? existing.city,
        notes: body.notes ?? existing.notes,
        status: body.status ?? existing.status,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_CUSTOMER',
      entityType: 'Customer',
      entityId: updated.id,
      oldValues: existing,
      newValues: updated,
      reason: 'تحديث بيانات العميل',
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تحديث بيانات العميل' }, { status: 500 });
  }
}
