import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { calculateExchange } from '@/lib/financial-core';
import { assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

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
      vouchers: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: sessions });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // RBAC: Only admin, accountant, and data_entry can create customer sessions
  if (!['admin', 'accountant', 'data_entry'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بفتح جلسة حسابية جديدة (مقتصر على المحاسب أو مدخل البيانات أو المدير)' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { customerId, requestedAmount, exchangeRate, businessDate } = body;

    if (!customerId || !requestedAmount || !exchangeRate) {
      return NextResponse.json(
        { error: 'العميل والمبلغ المطلوب وسعر الصرف مطلوبان' },
        { status: 400 }
      );
    }

    const numRequested = Number(requestedAmount);
    const numRate = Number(exchangeRate);

    if (isNaN(numRequested) || numRequested <= 0) {
      return NextResponse.json({ error: 'المبلغ المطلوب يجب أن يكون رقماً موجباً أكبر من الصفر' }, { status: 400 });
    }

    if (isNaN(numRate) || numRate <= 0) {
      return NextResponse.json({ error: 'سعر الصرف يجب أن يكون رقماً موجباً أكبر من الصفر' }, { status: 400 });
    }

    // Verify Customer existence and status
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return NextResponse.json({ error: 'العميل المحدد غير موجود في النظام' }, { status: 404 });
    }

    if (customer.status === 'blocked') {
      return NextResponse.json({ error: 'لا يمكن فتح جلسة لعميل محظور في النظام' }, { status: 400 });
    }

    if (customer.status === 'closed') {
      return NextResponse.json(
        { error: 'حساب العميل مقفل حالياً. لا يمكن فتح جلسة جديدة لعميل حسابه مقفل.', success: false },
        { status: 400 }
      );
    }

    const calc = calculateExchange(numRequested, numRate, 'EGP_TO_SDG');
    const bDate = businessDate || new Date().toISOString().split('T')[0];
    await assertBusinessDateOpen(bDate);
    const cleanDate = bDate.replace(/-/g, '');
    const prefix = `SES-${cleanDate}-`;

    // Concurrency-safe sequential sessionNumber generation with retry loop
    let session = null;
    let attempts = 0;
    const maxAttempts = 5;

    while (!session && attempts < maxAttempts) {
      attempts++;
      try {
        const latestSession = await prisma.customerSession.findFirst({
          where: { sessionNumber: { startsWith: prefix } },
          orderBy: { sessionNumber: 'desc' },
          select: { sessionNumber: true },
        });

        let nextSeq = 1001;
        if (latestSession && latestSession.sessionNumber) {
          const parts = latestSession.sessionNumber.split('-');
          if (parts.length >= 3) {
            const parsedSeq = parseInt(parts[2], 10);
            if (!isNaN(parsedSeq) && parsedSeq >= 1000) {
              nextSeq = parsedSeq + attempts; // Offset by attempts to quickly bypass concurrent clash
            }
          }
        }

        const candidateSessionNumber = `${prefix}${nextSeq}`;

        session = await prisma.customerSession.create({
          data: {
            sessionNumber: candidateSessionNumber,
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
            overpaymentAmount: 0,
            status: 'open',
            createdBy: user.name,
          },
          include: {
            customer: true,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002' && attempts < maxAttempts) {
          // Unique constraint collision retry
          await new Promise((resolve) => setTimeout(resolve, 30 * attempts));
          continue;
        }
        throw err;
      }
    }

    if (!session) {
      throw new Error('فشل توليد رقم جلسة فريد بعد محاولات متعددة بسبب الضغط المتزامن');
    }

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_CUSTOMER_SESSION',
      entityType: 'CustomerSession',
      entityId: session.id,
      newValues: session,
      reason: `فتح جلسة حساب يومية جديدة للعميل ${session.customer.name}`,
    });

    await createNotification({
      type: 'session_created',
      title: 'جلسة حساب يومية جديدة للعميل',
      message: `تم فتح جلسة جديدة برقم ${session.sessionNumber} للعميل ${session.customer.name}. المطلوب: ${numRequested.toLocaleString()} EGP مقابل ${Number(calc.toAmount).toLocaleString()} SDG`,
      referenceType: 'CustomerSession',
      referenceId: session.id,
      recipientRole: 'accountant',
      priority: 'normal',
    });

    return NextResponse.json({ success: true, data: session }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في فتح الجلسة' }, { status: 500 });
  }
}
