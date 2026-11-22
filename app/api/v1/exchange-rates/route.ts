import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

const SUPPORTED_CURRENCIES = ['EGP', 'SDG', 'USD', 'SAR', 'AED'];
const ALLOWED_RATE_TYPES = ['customer', 'supplier', 'market_benchmark'] as const;

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const fromCurrency = searchParams.get('fromCurrency')?.trim().toUpperCase();
  const toCurrency = searchParams.get('toCurrency')?.trim().toUpperCase();
  const rateType = searchParams.get('rateType')?.trim().toLowerCase();
  const activeOnly = searchParams.get('activeOnly') === 'true';

  const whereClause: any = {};
  if (fromCurrency) whereClause.fromCurrency = fromCurrency;
  if (toCurrency) whereClause.toCurrency = toCurrency;
  if (rateType) whereClause.rateType = rateType;
  if (activeOnly) whereClause.effectiveTo = null;

  const rates = await prisma.exchangeRate.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  });

  // Determine the active rates (the latest rate for each unique from_to_type combination)
  const activeRatesMap = new Map<string, any>();
  for (const r of rates) {
    const key = `${r.fromCurrency}_${r.toCurrency}_${r.rateType}`;
    if (!activeRatesMap.has(key)) {
      activeRatesMap.set(key, {
        id: r.id,
        fromCurrency: r.fromCurrency,
        toCurrency: r.toCurrency,
        rateType: r.rateType,
        rate: Number(r.rate),
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        isActive: r.effectiveTo === null,
      });
    }
  }

  // Calculate spreads per currency pair (Customer rate vs Supplier rate)
  const pairs = new Set<string>();
  rates.forEach((r) => pairs.add(`${r.fromCurrency}/${r.toCurrency}`));

  const spreads: Record<string, { customerRate: number | null; supplierRate: number | null; marketRate: number | null; spread: number | null; marginPercent: number | null }> = {};
  Array.from(pairs).forEach((pair) => {
    const [from, to] = pair.split('/');
    const cust = activeRatesMap.get(`${from}_${to}_customer`);
    const supp = activeRatesMap.get(`${from}_${to}_supplier`);
    const mkt = activeRatesMap.get(`${from}_${to}_market_benchmark`);

    const cRate = cust ? cust.rate : null;
    const sRate = supp ? supp.rate : null;
    const mRate = mkt ? mkt.rate : null;

    let spread: number | null = null;
    let marginPercent: number | null = null;
    if (cRate !== null && sRate !== null && sRate > 0) {
      spread = Number(new Decimal(cRate).minus(new Decimal(sRate)).toFixed(4));
      marginPercent = Number(new Decimal(spread).dividedBy(new Decimal(sRate)).times(100).toFixed(2));
    }

    spreads[pair] = {
      customerRate: cRate,
      supplierRate: sRate,
      marketRate: mRate,
      spread,
      marginPercent,
    };
  });

  // Array of formatted rates for backward-compatibility
  const formattedRates = rates.map((r) => ({
    id: r.id,
    fromCurrency: r.fromCurrency,
    toCurrency: r.toCurrency,
    rateType: r.rateType,
    rate: Number(r.rate),
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    isActive: r.effectiveTo === null,
  }));

  return NextResponse.json({
    success: true,
    data: formattedRates,
    activeRates: Array.from(activeRatesMap.values()),
    spreads,
    supportedCurrencies: SUPPORTED_CURRENCIES,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can update exchange rates
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتعديل أسعار الصرف (مقتصر على المدراء والمحاسبين فقط)' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { fromCurrency, toCurrency, rateType, rate, reason } = body;

    // 1. Validation: Currencies
    const cleanFrom = String(fromCurrency || '').trim().toUpperCase();
    const cleanTo = String(toCurrency || '').trim().toUpperCase();
    const cleanType = String(rateType || '').trim().toLowerCase();

    if (!cleanFrom || !cleanTo) {
      return NextResponse.json({ error: 'العملة الأساس والعملة المقابلة مطلوبة' }, { status: 400 });
    }

    if (cleanFrom === cleanTo) {
      return NextResponse.json({ error: 'لا يمكن تحديد سعر صرف لنفس العملة' }, { status: 400 });
    }

    // 2. Validation: Rate Type
    if (!ALLOWED_RATE_TYPES.includes(cleanType as any)) {
      return NextResponse.json(
        { error: `نوع السعر غير صالح. الأنواع المسموحة: ${ALLOWED_RATE_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // 3. Validation: Decimal Precision and Bounds
    if (rate === undefined || rate === null || rate === '') {
      return NextResponse.json({ error: 'قيمة سعر الصرف مطلوبة' }, { status: 400 });
    }

    let dRate: Decimal;
    try {
      dRate = new Decimal(rate);
    } catch {
      return NextResponse.json({ error: 'قيمة سعر الصرف المدخلة غير صالحة رياضياً' }, { status: 400 });
    }

    if (!dRate.isFinite() || dRate.isNaN()) {
      return NextResponse.json({ error: 'قيمة سعر الصرف غير صالحة (NaN أو غير محدد)' }, { status: 400 });
    }

    if (dRate.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'سعر الصرف يجب أن يكون رقماً موجباً أكبر من الصفر' }, { status: 400 });
    }

    if (dRate.greaterThan(10000000) || dRate.lessThan(0.000001)) {
      return NextResponse.json({ error: 'قيمة سعر الصرف خارج النطاق المنطقي المسموح' }, { status: 400 });
    }

    const now = new Date();

    // 4. Atomic Execution & History Preservation with Row Lock
    const result = await prisma.$transaction(async (tx) => {
      // Find latest active rate before updating
      const prevActiveRate = await tx.exchangeRate.findFirst({
        where: {
          fromCurrency: cleanFrom,
          toCurrency: cleanTo,
          rateType: cleanType,
          effectiveTo: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Mark all previous open rates as expired at effectiveTo: now
      await tx.exchangeRate.updateMany({
        where: {
          fromCurrency: cleanFrom,
          toCurrency: cleanTo,
          rateType: cleanType,
          effectiveTo: null,
        },
        data: { effectiveTo: now },
      });

      // Insert new rate record with effectiveFrom: now and effectiveTo: null
      const createdRate = await tx.exchangeRate.create({
        data: {
          fromCurrency: cleanFrom,
          toCurrency: cleanTo,
          rateType: cleanType,
          rate: dRate.toFixed(4),
          effectiveFrom: now,
          effectiveTo: null,
          createdBy: user.name || user.email || user.userId || 'system',
        },
      });

      return { createdRate, prevActiveRate };
    });

    const oldRateNum = result.prevActiveRate ? Number(result.prevActiveRate.rate) : null;
    const newRateNum = Number(result.createdRate.rate);

    // 5. Audit Logging with full traceability
    const typeLabel =
      cleanType === 'customer'
        ? 'سعر العملاء'
        : cleanType === 'supplier'
        ? 'سعر الموردين'
        : 'سعر السوق المرجعي';

    const defaultReason = oldRateNum !== null
      ? `تحديث ${typeLabel} لزوج ${cleanFrom}/${cleanTo} من ${oldRateNum} إلى ${newRateNum}`
      : `تثبيت ${typeLabel} أولي لزوج ${cleanFrom}/${cleanTo} بقيمة ${newRateNum}`;

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_EXCHANGE_RATE',
      entityType: 'ExchangeRate',
      entityId: result.createdRate.id,
      oldValues: result.prevActiveRate ? {
        id: result.prevActiveRate.id,
        rate: oldRateNum,
        rateType: cleanType,
        fromCurrency: cleanFrom,
        toCurrency: cleanTo,
      } : null,
      newValues: {
        id: result.createdRate.id,
        rate: newRateNum,
        rateType: cleanType,
        fromCurrency: cleanFrom,
        toCurrency: cleanTo,
        effectiveFrom: now.toISOString(),
      },
      reason: reason?.trim() || defaultReason,
    });

    return NextResponse.json(
      {
        success: true,
        message: `تم تحديث ${typeLabel} لزوج ${cleanFrom}/${cleanTo} بنجاح`,
        data: {
          ...result.createdRate,
          rate: newRateNum,
          isActive: true,
        },
        previousRate: oldRateNum,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تحديث سعر الصرف' }, { status: 500 });
  }
}
