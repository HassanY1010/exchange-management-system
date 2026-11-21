import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
  });

  if (!customer) {
    return NextResponse.json({ error: 'العميل غير موجود', success: false }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');

  const sessionsWhere: any = {
    customerId: customer.id,
    status: { not: 'cancelled' }, // Strictly exclude cancelled sessions
  };

  if (fromDate || toDate) {
    sessionsWhere.businessDate = {};
    if (fromDate) sessionsWhere.businessDate.gte = fromDate;
    if (toDate) sessionsWhere.businessDate.lte = toDate;
  }

  const sessions = await prisma.customerSession.findMany({
    where: sessionsWhere,
    include: {
      receipts: {
        where: { status: 'approved' },
      },
      vouchers: {
        where: { status: 'issued' },
      },
      transactions: true,
    },
    orderBy: { businessDate: 'desc' },
  });

  // Calculate cumulative financial totals accurately
  let totalReceivedSdg = 0;
  let totalDeliveredEgp = 0;
  let totalRequestedEgp = 0;
  let totalExpectedSdg = 0;
  let totalRemainingSdg = 0;
  let totalOverpaymentSdg = 0;
  let completedCount = 0;
  let pendingDeliveryCount = 0;

  for (const s of sessions) {
    totalReceivedSdg += Number(s.receivedAmount || 0);
    totalDeliveredEgp += Number(s.deliveredAmount || 0);
    totalRequestedEgp += Number(s.requestedAmount || 0);
    totalExpectedSdg += Number(s.expectedAmount || 0);
    totalRemainingSdg += Number(s.remainingAmount || 0);
    totalOverpaymentSdg += Number(s.overpaymentAmount || 0);

    if (s.status === 'completed') {
      completedCount++;
    } else if (s.status === 'pending_delivery') {
      pendingDeliveryCount++;
    }
  }

  const companySetting = await prisma.setting.findUnique({
    where: { key: 'company_name' },
  }).catch(() => null);

  return NextResponse.json({
    success: true,
    statement: {
      companyName: companySetting?.value || 'شركة النجم لخدمات الصرافة والتحويلات المالية',
      customer: {
        id: customer.id,
        code: customer.customerCode,
        name: customer.name,
        phone: customer.phone,
        secondaryPhone: customer.secondaryPhone,
        whatsapp: customer.whatsapp,
        city: customer.city,
        address: customer.address,
        identityNumber: customer.identityNumber,
        status: customer.status,
      },
      summary: {
        totalReceivedSdg,
        totalDeliveredEgp,
        totalRequestedEgp,
        totalExpectedSdg,
        totalRemainingSdg,
        totalOverpaymentSdg,
        sessionsCount: sessions.length,
        completedCount,
        pendingDeliveryCount,
      },
      generatedAt: new Date().toISOString(),
      generatedBy: user.name,
      userRole: user.role,
      sessions,
    },
  });
}
