import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { calculateExchange } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const customerId = searchParams.get('customerId');
  const status = searchParams.get('status');

  const whereClause: any = {};
  if (date) whereClause.businessDate = date;
  if (customerId) whereClause.customerId = customerId;
  if (status) whereClause.status = status;

  const sessions = await prisma.customerSession.findMany({
    where: whereClause,
    include: {
      customer: true,
      receipts: {
        orderBy: { createdAt: 'desc' },
      },
      transactions: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: sessions });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const body = await req.json();
    const { customerId, requestedAmount, exchangeRate, businessDate } = body;

    if (!customerId || !requestedAmount || !exchangeRate) {
      return NextResponse.json(
        { error: 'العميل والمبلغ المطلوب وسعر الصرف مطلوبان' },
        { status: 400 }
      );
    }

    const calc = calculateExchange(requestedAmount, exchangeRate, 'EGP_TO_SDG');
    const bDate = businessDate || new Date().toISOString().split('T')[0];
    const sessionNumber = `SES-${bDate.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const session = await prisma.customerSession.create({
      data: {
        sessionNumber,
        customerId,
        businessDate: bDate,
        exchangeRate: calc.rate,
        currencyFrom: 'SDG',
        currencyTo: 'EGP',
        requestedAmount: calc.fromAmount, // EGP
        expectedAmount: calc.toAmount,   // SDG
        receivedAmount: 0,
        deliveredAmount: 0,
        remainingAmount: calc.toAmount,
        status: 'open',
        createdBy: user.name,
      },
      include: {
        customer: true,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_CUSTOMER_SESSION',
      entityType: 'CustomerSession',
      entityId: session.id,
      newValues: session,
      reason: `فتح جلسة حساب يومية جديدة للعميل ${session.customer.name}`,
    });

    return NextResponse.json({ success: true, data: session }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في فتح الجلسة' }, { status: 500 });
  }
}
