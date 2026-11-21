import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const rates = await prisma.exchangeRate.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: rates });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { fromCurrency, toCurrency, rateType, rate } = await req.json();

    const numRate = Number(rate);
    if (!fromCurrency || !toCurrency || !rateType || !numRate || numRate <= 0) {
      return NextResponse.json({ error: 'العملات ونوع السعر وقيمة السعر مطلوبة' }, { status: 400 });
    }

    const exchangeRate = await prisma.exchangeRate.create({
      data: {
        fromCurrency,
        toCurrency,
        rateType,
        rate: numRate,
        createdBy: user.name,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_EXCHANGE_RATE',
      entityType: 'ExchangeRate',
      entityId: exchangeRate.id,
      newValues: exchangeRate,
      reason: `تحديث سعر الصرف: ${fromCurrency}/${toCurrency} (${rateType}) = ${numRate}`,
    });

    return NextResponse.json({ success: true, data: exchangeRate }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تحديث سعر الصرف' }, { status: 500 });
  }
}
