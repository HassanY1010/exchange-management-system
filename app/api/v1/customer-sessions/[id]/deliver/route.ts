import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const session = await prisma.customerSession.findUnique({
      where: { id: params.id },
      include: { customer: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 });
    }

    if (session.status === 'completed' || session.status === 'cancelled') {
      return NextResponse.json({ error: 'لا يمكن تسليم مبالغ لجلسة مغلقة أو ملغاة' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const amountEgp = Number(body.amountEgp || session.requestedAmount);

    if (amountEgp <= 0) {
      return NextResponse.json({ error: 'المبلغ المسلم يجب أن يكون أكبر من الصفر' }, { status: 400 });
    }

    // Determine cash delivery account (safe 1010 or custody 1050)
    let sourceAccount = null;
    if (body.accountId) {
      sourceAccount = await prisma.account.findUnique({ where: { id: body.accountId } });
    } else {
      sourceAccount = await prisma.account.findFirst({
        where: { accountCode: '1010' }, // Main EGP Safe
      });
    }

    if (!sourceAccount) {
      return NextResponse.json({ error: 'حساب الصندوق النقدي المصري غير موجود' }, { status: 400 });
    }

    // Verify source account balance
    const currentSafeBalance = new Decimal(sourceAccount.currentBalance.toString());
    if (currentSafeBalance.lessThan(amountEgp)) {
      return NextResponse.json({
        error: `رصيد الصندوق النقدي لا يكفي. الرصيد الحالي: ${currentSafeBalance.toFixed(2)} EGP، والمطلوب: ${amountEgp} EGP`,
      }, { status: 400 });
    }

    const customerLiabilityAccount = await prisma.account.findFirst({
      where: { accountCode: '2010' },
    });

    if (!customerLiabilityAccount) {
      return NextResponse.json({ error: 'حساب وسيط التزامات العملاء غير مهيأ في الدليل' }, { status: 500 });
    }

    const exchangeRate = Number(session.exchangeRate);
    const equivalentSdg = new Decimal(amountEgp).times(exchangeRate).toNumber();

    // 1. Post double-entry accounting transactions for multi-currency settlement
    // Leg A: Clear customer SDG liability against FX clearing if 2015/1065 exist
    const customerLiabilitySdg = await prisma.account.findFirst({ where: { accountCode: '2015' } });
    const currencyClearingSdg = await prisma.account.findFirst({ where: { accountCode: '1065' } });

    if (customerLiabilitySdg && currencyClearingSdg) {
      await postLedgerTransaction({
        entryType: 'currency_exchange_sdg_clear',
        referenceType: 'CustomerSession',
        referenceId: session.id,
        description: `تسوية التزام العميل بالسوداني ${equivalentSdg.toLocaleString()} SDG لجلسة ${session.sessionNumber}`,
        createdBy: user.name,
        lines: [
          {
            accountId: customerLiabilitySdg.id,
            currency: 'SDG',
            debit: equivalentSdg,
            credit: 0,
            description: `تسوية التزام العميل ${session.customer.name}`,
          },
          {
            accountId: currencyClearingSdg.id,
            currency: 'SDG',
            debit: 0,
            credit: equivalentSdg,
            description: `إقفال في وسيط تسوية العملات`,
          },
        ],
      });
    }

    // Leg B: Deliver cash in EGP from safe and debit customer liability / clearing
    await postLedgerTransaction({
      entryType: 'customer_cash_delivery',
      referenceType: 'CustomerSession',
      referenceId: session.id,
      description: `تسليم نقدي ${amountEgp.toLocaleString()} EGP للعميل ${session.customer.name} (جلسة ${session.sessionNumber})`,
      createdBy: user.name,
      lines: [
        {
          accountId: customerLiabilityAccount.id,
          currency: 'EGP',
          debit: amountEgp,
          credit: 0,
          description: `تسوية التزام العميل ${session.customer.name}`,
        },
        {
          accountId: sourceAccount.id,
          currency: 'EGP',
          debit: 0,
          credit: amountEgp,
          description: `صرف نقدي من الصندوق ${sourceAccount.name}`,
        },
      ],
    });

    // 2. Create ExchangeTransaction record
    const txnNumber = `TXN-${Date.now()}`;
    const exchangeTxn = await prisma.exchangeTransaction.create({
      data: {
        transactionNumber: txnNumber,
        customerId: session.customerId,
        customerSessionId: session.id,
        transactionType: 'SDG_TO_EGP',
        fromCurrency: 'SDG',
        toCurrency: 'EGP',
        fromAmount: equivalentSdg,
        toAmount: amountEgp,
        exchangeRate: exchangeRate,
        status: 'approved',
        sourceAccountId: customerLiabilityAccount.id,
        destinationAccountId: sourceAccount.id,
        employeeId: body.employeeId || null,
        createdBy: user.name,
        approvedBy: user.name,
        approvedAt: new Date(),
      },
    });

    // 3. Update Customer Session
    const newDelivered = Number(session.deliveredAmount) + amountEgp;
    const receivedAmount = Number(session.receivedAmount);
    const expectedAmount = Number(session.expectedAmount);
    const requestedAmount = Number(session.requestedAmount);

    let nextStatus = session.status;
    if (newDelivered >= requestedAmount && receivedAmount >= expectedAmount) {
      nextStatus = 'completed';
    } else if (newDelivered > 0) {
      nextStatus = 'partially_delivered';
    }

    const updatedSession = await prisma.customerSession.update({
      where: { id: session.id },
      data: {
        deliveredAmount: newDelivered,
        status: nextStatus,
        closedAt: nextStatus === 'completed' ? new Date() : null,
        closedBy: nextStatus === 'completed' ? user.name : null,
      },
      include: {
        customer: true,
        receipts: true,
        transactions: true,
      },
    });

    // 4. Audit Log
    await logAuditEvent({
      userId: user.userId,
      action: 'DELIVER_CUSTOMER_CASH',
      entityType: 'CustomerSession',
      entityId: session.id,
      newValues: { amountEgp, equivalentSdg, deliveredAmount: newDelivered, status: nextStatus },
      reason: `تسليم نقدية بالجنيه المصري للعميل ${session.customer.name}`,
    });

    return NextResponse.json({
      success: true,
      data: {
        session: updatedSession,
        exchangeTransaction: exchangeTxn,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ أثناء تسليم النقدية' }, { status: 500 });
  }
}
