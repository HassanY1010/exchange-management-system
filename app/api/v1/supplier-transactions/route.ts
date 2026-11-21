import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const supplierId = searchParams.get('supplierId');

  const whereClause: any = {};
  if (supplierId) whereClause.supplierId = supplierId;

  const transactions = await prisma.supplierTransaction.findMany({
    where: whereClause,
    include: { supplier: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: transactions });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const body = await req.json();
    const {
      supplierId,
      transactionType, // BUY_SDG_PAY_EGP, SELL_SDG_GET_EGP
      fromAmount,
      toAmount,
      exchangeRate,
      feeAmount,
    } = body;

    if (!supplierId || !transactionType || !fromAmount || !toAmount || !exchangeRate) {
      return NextResponse.json({ error: 'جميع بيانات العملية وسعر الصرف والمبالغ مطلوبة' }, { status: 400 });
    }

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) {
      return NextResponse.json({ error: 'المورد غير موجود' }, { status: 404 });
    }

    const egpSafe = await prisma.account.findFirst({ where: { accountCode: '1010' } });
    const sdgSafe = await prisma.account.findFirst({ where: { accountCode: '1020' } }) ||
                    await prisma.account.findFirst({ where: { accountCode: '1030' } });
    const supplierAccount = await prisma.account.findFirst({ where: { accountCode: '2020' } }) ||
                            await prisma.account.findFirst({ where: { accountCode: '4010' } });
    const profitAccount = await prisma.account.findFirst({ where: { accountCode: '4010' } });

    if (!egpSafe || !sdgSafe || !supplierAccount) {
      throw new Error('الحسابات المالية الخاصة بالصرافة والموردين غير مكتملة');
    }

    const count = await prisma.supplierTransaction.count();
    const transactionNumber = `SUP-TXN-${Date.now()}-${count + 1}`;

    const isBuyingSdg = transactionType === 'BUY_SDG_PAY_EGP';
    const fromCurrency = isBuyingSdg ? 'SDG' : 'EGP';
    const toCurrency = isBuyingSdg ? 'EGP' : 'SDG';

    // 1. Post double-entry transaction using multi-currency clearing
    if (isBuyingSdg) {
      // Step A: Receive SDG into SDG Safe (Debit SDG Safe, Credit Supplier Account)
      await postLedgerTransaction({
        entryType: 'supplier_purchase_sdg',
        referenceType: 'SupplierTransaction',
        description: `شراء واستلام ${Number(fromAmount).toLocaleString()} SDG من المورد ${supplier.name}`,
        createdBy: user.name,
        lines: [
          {
            accountId: sdgSafe.id,
            currency: 'SDG',
            debit: Number(fromAmount),
            credit: 0,
            description: `إيداع عملة في الخزينة من المورد ${supplier.name}`,
          },
          {
            accountId: supplierAccount.id,
            currency: 'SDG',
            debit: 0,
            credit: Number(fromAmount),
            description: `استحقاق المورد ${supplier.name} بالعملة المشتراة`,
          },
        ],
      });

      // Step B: Pay EGP from EGP Safe (Debit Supplier Account, Credit EGP Safe)
      await postLedgerTransaction({
        entryType: 'supplier_payment_egp',
        referenceType: 'SupplierTransaction',
        description: `سداد قيمة شراء العملة ${Number(toAmount).toLocaleString()} EGP للمورد ${supplier.name}`,
        createdBy: user.name,
        lines: [
          {
            accountId: supplierAccount.id,
            currency: 'EGP',
            debit: Number(toAmount),
            credit: 0,
            description: `تسوية التزام المورد ${supplier.name}`,
          },
          {
            accountId: egpSafe.id,
            currency: 'EGP',
            debit: 0,
            credit: Number(toAmount),
            description: `صرف كاش مصري من الخزينة للمورد ${supplier.name}`,
          },
        ],
      });
    } else {
      // Step A: Receive EGP into EGP Safe
      await postLedgerTransaction({
        entryType: 'supplier_sale_egp',
        referenceType: 'SupplierTransaction',
        description: `استلام كاش ${Number(toAmount).toLocaleString()} EGP من المورد ${supplier.name}`,
        createdBy: user.name,
        lines: [
          {
            accountId: egpSafe.id,
            currency: 'EGP',
            debit: Number(toAmount),
            credit: 0,
            description: `إيداع كاش مصري في الخزينة من المورد ${supplier.name}`,
          },
          {
            accountId: supplierAccount.id,
            currency: 'EGP',
            debit: 0,
            credit: Number(toAmount),
            description: `تسوية التزام المورد ${supplier.name}`,
          },
        ],
      });

      // Step B: Deliver SDG from SDG Safe
      await postLedgerTransaction({
        entryType: 'supplier_sale_sdg',
        referenceType: 'SupplierTransaction',
        description: `تسليم عملة ${Number(fromAmount).toLocaleString()} SDG للمورد ${supplier.name}`,
        createdBy: user.name,
        lines: [
          {
            accountId: supplierAccount.id,
            currency: 'SDG',
            debit: Number(fromAmount),
            credit: 0,
            description: `استحقاق تسليم العملة للمورد ${supplier.name}`,
          },
          {
            accountId: sdgSafe.id,
            currency: 'SDG',
            debit: 0,
            credit: Number(fromAmount),
            description: `صرف عملة من الخزينة للمورد ${supplier.name}`,
          },
        ],
      });
    }

    // 2. Create supplier transaction record
    const txn = await prisma.supplierTransaction.create({
      data: {
        transactionNumber,
        supplierId: supplier.id,
        transactionType,
        fromCurrency,
        toCurrency,
        fromAmount: Number(fromAmount),
        toAmount: Number(toAmount),
        exchangeRate: Number(exchangeRate),
        feeAmount: Number(feeAmount || 0),
        status: 'completed',
        createdBy: user.name,
      },
      include: { supplier: true },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'SUPPLIER_TRANSACTION',
      entityType: 'SupplierTransaction',
      entityId: txn.id,
      newValues: txn,
      reason: `عملية ${isBuyingSdg ? 'شراء' : 'بيع'} عملة مع المورد ${supplier.name}`,
    });

    return NextResponse.json({ success: true, data: txn }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تنفيذ عملية المورد' }, { status: 500 });
  }
}
