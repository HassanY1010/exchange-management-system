import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search')?.trim();

  const whereClause: any = {};
  if (status) whereClause.status = status;
  if (search) {
    whereClause.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { supplierCode: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }

  const suppliers = await prisma.supplier.findMany({
    where: whereClause,
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
      _count: {
        select: { transactions: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate detailed financial aggregates per supplier
  const suppliersWithStats = suppliers.map((sup) => {
    let totalBoughtSdg = 0;
    let totalPaidEgp = 0;
    let totalSoldSdg = 0;
    let totalReceivedEgp = 0;
    let totalProfitGenerated = 0;

    for (const t of sup.transactions) {
      if (t.status === 'completed') {
        if (t.transactionType === 'BUY_SDG_PAY_EGP') {
          totalBoughtSdg += Number(t.fromAmount);
          totalPaidEgp += Number(t.toAmount);
        } else if (t.transactionType === 'SELL_SDG_GET_EGP') {
          totalSoldSdg += Number(t.fromAmount);
          totalReceivedEgp += Number(t.toAmount);
          totalProfitGenerated += Number(t.profitAmount || 0);
        }
      }
    }

    return {
      id: sup.id,
      supplierCode: sup.supplierCode,
      name: sup.name,
      phone: sup.phone,
      whatsapp: sup.whatsapp,
      address: sup.address,
      notes: sup.notes,
      status: sup.status,
      createdAt: sup.createdAt,
      stats: {
        totalBoughtSdg,
        totalPaidEgp,
        totalSoldSdg,
        totalReceivedEgp,
        totalProfitGenerated,
        transactionsCount: sup.transactions.length,
        lastTransactionDate: sup.transactions[0]?.createdAt || null,
      },
    };
  });

  return NextResponse.json({ success: true, data: suppliersWithStats });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية إضافة مورد جديد مقتصرة على المدير والمحاسب' },
      { status: 403 }
    );
  }

  try {
    const { name, phone, whatsapp, address, notes } = await req.json();

    if (!name || !phone) {
      return NextResponse.json({ error: 'اسم المورد ورقم الهاتف مطلوبان' }, { status: 400 });
    }

    // Check duplicate phone or name
    const existing = await prisma.supplier.findFirst({
      where: {
        OR: [
          { phone: phone.trim() },
          { name: { equals: name.trim(), mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'يوجد مورد مسجل مسبقاً بنفس الاسم أو رقم الهاتف' },
        { status: 400 }
      );
    }

    const count = await prisma.supplier.count();
    const supplierCode = `SUP-${(500 + count + 1).toString()}`;

    const supplier = await prisma.supplier.create({
      data: {
        supplierCode,
        name: name.trim(),
        phone: phone.trim(),
        whatsapp: whatsapp?.trim() || phone.trim(),
        address: address?.trim() || null,
        notes: notes?.trim() || null,
        status: 'active',
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_SUPPLIER',
      entityType: 'Supplier',
      entityId: supplier.id,
      newValues: supplier,
      reason: `إضافة مورد عملات جديد (${supplier.name})`,
    });

    return NextResponse.json({ success: true, data: supplier }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء المورد' }, { status: 500 });
  }
}
