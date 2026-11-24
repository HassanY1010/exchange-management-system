import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('q')?.trim() || '';
  const status = searchParams.get('status') || '';

  const whereClause: any = {};
  if (status) {
    whereClause.status = status;
  }
  if (search) {
    whereClause.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { secondaryPhone: { contains: search } },
      { customerCode: { contains: search, mode: 'insensitive' } },
      { identityNumber: { contains: search } },
      { city: { contains: search, mode: 'insensitive' } },
    ];
  }

  const customers = await prisma.customer.findMany({
    where: whereClause,
    include: {
      sessions: {
        where: { status: { not: 'cancelled' } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      _count: {
        select: {
          sessions: true,
          receipts: true,
          transactions: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Fetch all active debts for these customers in a single batch query
  const customerIds = customers.map((c) => c.id);
  const activeDebts = await prisma.debt.findMany({
    where: {
      status: { in: ['outstanding', 'partially_paid', 'overdue'] },
      OR: [
        { debtorType: 'customer', debtorId: { in: customerIds } },
        { creditorType: 'customer', creditorId: { in: customerIds } },
      ],
    },
  });

  const enrichedCustomers = customers.map((c) => {
    let egpDebtorD = new Decimal(0);
    let egpCreditorD = new Decimal(0);
    let sdgDebtorD = new Decimal(0);
    let sdgCreditorD = new Decimal(0);

    // 1. Debts
    for (const d of activeDebts) {
      const cur = (d.currency || '').toUpperCase();
      const remD = new Decimal(d.remainingAmount.toString());
      if (d.debtorType === 'customer' && d.debtorId === c.id) {
        if (cur === 'EGP') egpDebtorD = egpDebtorD.plus(remD);
        else if (cur === 'SDG') sdgDebtorD = sdgDebtorD.plus(remD);
      }
      if (d.creditorType === 'customer' && d.creditorId === c.id) {
        if (cur === 'EGP') egpCreditorD = egpCreditorD.plus(remD);
        else if (cur === 'SDG') sdgCreditorD = sdgCreditorD.plus(remD);
      }
    }

    // 2. Active Sessions
    let pendingSessionsCount = 0;
    for (const s of c.sessions) {
      const isCompleted = s.status === 'completed';
      const isCancelled = s.status === 'cancelled';
      const reqEgpD = new Decimal(s.requestedAmount?.toString() || 0);
      const delEgpD = new Decimal(s.deliveredAmount?.toString() || 0);
      const undeliveredEgpD = Decimal.max(0, reqEgpD.minus(delEgpD));
      const overpaymentD = new Decimal(s.overpaymentAmount?.toString() || 0);

      if (overpaymentD.greaterThan(0) && !s.overpaymentSettled) {
        sdgCreditorD = sdgCreditorD.plus(overpaymentD);
      }

      if (!isCompleted && !isCancelled) {
        pendingSessionsCount++;
        if (undeliveredEgpD.greaterThan(0)) {
          egpCreditorD = egpCreditorD.plus(undeliveredEgpD);
        }
      }
    }

    const canClose =
      egpDebtorD.isZero() &&
      egpCreditorD.isZero() &&
      sdgDebtorD.isZero() &&
      sdgCreditorD.isZero() &&
      pendingSessionsCount === 0;

    return {
      ...c,
      pendingSessionsCount,
      canClose,
      balances: {
        EGP: { debtor: egpDebtorD.toNumber(), creditor: egpCreditorD.toNumber() },
        SDG: { debtor: sdgDebtorD.toNumber(), creditor: sdgCreditorD.toNumber() },
      },
    };
  });

  return NextResponse.json({ success: true, data: enrichedCustomers });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // RBAC permission check for customer creation
  if (!['admin', 'accountant', 'data_entry'].includes(user.role)) {
    return NextResponse.json(
      { error: 'ليس لديك صلاحية إضافة عميل جديد في النظام', success: false },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { name, phone, secondaryPhone, whatsapp, identityNumber, address, city, notes } = body;

    // Strict field validations
    if (!name || typeof name !== 'string' || name.trim().length < 3) {
      return NextResponse.json(
        { error: 'اسم العميل مطلوب ويجب أن يحتوي على 3 أحرف على الأقل', success: false },
        { status: 400 }
      );
    }

    if (!phone || typeof phone !== 'string' || phone.trim().length < 7) {
      return NextResponse.json(
        { error: 'رقم الهاتف مطلوب ويجب أن يحتوي على 7 أرقام على الأقل', success: false },
        { status: 400 }
      );
    }

    const cleanPhone = phone.trim();
    const cleanName = name.trim();

    // Check for existing active customer with the same primary phone
    const existing = await prisma.customer.findFirst({
      where: {
        phone: cleanPhone,
        status: 'active',
      },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: `يوجد عميل مسجل بالفعل برقم الهاتف هذا: ${existing.name} (${existing.customerCode})`,
          success: false,
        },
        { status: 400 }
      );
    }

    // Safe, collision-free customer code generation under concurrency
    const existingCustCodes = await prisma.customer.findMany({
      where: { customerCode: { startsWith: 'CUST-' } },
      select: { customerCode: true },
    });

    let maxNum = 1000;
    for (const c of existingCustCodes) {
      const numPart = parseInt(c.customerCode.replace('CUST-', ''), 10);
      if (!isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart;
      }
    }
    let nextNum = maxNum + 1;

    // Default WhatsApp to phone if empty
    const resolvedWhatsapp = (whatsapp && typeof whatsapp === 'string' && whatsapp.trim().length > 0)
      ? whatsapp.trim()
      : cleanPhone;

    // Retry loop on unique constraint collision
    let customer = null;
    let attempts = 0;
    while (!customer && attempts < 5) {
      const candidateCode = `CUST-${nextNum + attempts}`;
      try {
        customer = await prisma.customer.create({
          data: {
            customerCode: candidateCode,
            name: cleanName,
            phone: cleanPhone,
            secondaryPhone: secondaryPhone?.trim() || null,
            whatsapp: resolvedWhatsapp,
            identityNumber: identityNumber?.trim() || null,
            address: address?.trim() || null,
            city: city?.trim() || 'القاهرة',
            notes: notes?.trim() || null,
            status: 'active',
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          attempts++;
        } else {
          throw err;
        }
      }
    }

    if (!customer) {
      throw new Error('تعذر توليد كود عميل فريد، يرجى إعادة المحاولة');
    }

    // Audit Logging
    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_CUSTOMER',
      entityType: 'Customer',
      entityId: customer.id,
      newValues: {
        id: customer.id,
        customerCode: customer.customerCode,
        name: customer.name,
        phone: customer.phone,
        city: customer.city,
      },
      reason: `إضافة عميل جديد للنظام بواسطة ${user.name} (${user.role})`,
    });

    return NextResponse.json({ success: true, data: customer }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating customer:', error);
    return NextResponse.json(
      { error: error.message || 'خطأ في إنشاء العميل', success: false },
      { status: 500 }
    );
  }
}
