import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';
import Decimal from 'decimal.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'custody_officer'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية صرف النقدية مقتصرة على مسؤول العهدة والتسليم (أو المدير العام استثنائياً)' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      accountId,
      employeeId,
      notes,
      recipientName,
      allowPartial = false,
      idempotencyKey,
    } = body;

    // 1. Concurrency Lock & Idempotency Check on CustomerSession
    const sessionData = await prisma.$transaction(async (tx) => {
      const lockedSessionRows = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "status", "requestedAmount", "expectedAmount", "receivedAmount", "deliveredAmount", "exchangeRate", "customerId", "sessionNumber", "payoutIdempotencyKey" FROM "CustomerSession" WHERE id = $1 FOR UPDATE',
        params.id
      );

      if (!lockedSessionRows || lockedSessionRows.length === 0) {
        throw new Error('الجلسة الحسابية غير موجودة');
      }

      const locked = lockedSessionRows[0];

      // Idempotency: If request with same idempotencyKey was already fulfilled, return existing state
      if (idempotencyKey && locked.payoutIdempotencyKey === idempotencyKey && locked.status === 'completed') {
        const existingVoucher = await tx.cashPayoutVoucher.findFirst({
          where: { customerSessionId: locked.id },
        });
        return { isIdempotentReplay: true, session: locked, voucher: existingVoucher };
      }

      if (locked.status === 'completed') {
        throw new Error('تم صرف وتسليم هذه الجلسة مسبقاً بالكامل، ولا يمكن تكرار الصرف');
      }

      if (locked.status === 'cancelled') {
        throw new Error('لا يمكن صرف نقدية لجلسة ملغاة');
      }

      const received = new Decimal(locked.receivedAmount.toString());
      const expected = new Decimal(locked.expectedAmount.toString());

      // Validate receipt satisfaction (Strict zero-unverified payout protection)
      if (received.lessThan(expected)) {
        if (!allowPartial || user.role !== 'admin') {
          throw new Error(
            `لا يمكن صرف النقدية للعميل قبل استيفاء واعتماد كامل إيصالات بنكك المطلوبة. المعتمد حالياً: ${received.toFixed(2)} SDG، والمطلوب: ${expected.toFixed(2)} SDG`
          );
        }
        if (!notes || notes.trim().length < 5) {
          throw new Error('يجب تقديم سبب توثيقي إلزامي (لا يقل عن 5 أحرف) لتجاوز الصرف الاستثنائي الجزئي بواسطة المدير العام');
        }
      }

      return { isIdempotentReplay: false, session: locked };
    });

    if (sessionData.isIdempotentReplay) {
      return NextResponse.json({
        success: true,
        message: 'تم استرجاع إيصال الصرف المنفذ مسبقاً (Idempotent Request)',
        data: { session: sessionData.session, voucher: sessionData.voucher },
      });
    }

    const session = await prisma.customerSession.findUnique({
      where: { id: params.id },
      include: { customer: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 });
    }

    const amountEgp = Number(body.amountEgp || session.requestedAmount);
    if (amountEgp <= 0) {
      return NextResponse.json({ error: 'المبلغ المسلم يجب أن يكون أكبر من الصفر' }, { status: 400 });
    }

    // Determine cash delivery source account (safe 1010 or specific custody)
    let sourceAccount = null;
    if (accountId) {
      sourceAccount = await prisma.account.findUnique({ where: { id: accountId } });
    } else {
      sourceAccount = await prisma.account.findFirst({
        where: { accountCode: '1010' }, // Main EGP Safe
      });
    }

    if (!sourceAccount) {
      return NextResponse.json({ error: 'حساب الصندوق النقدي المصري غير موجود' }, { status: 400 });
    }

    // Pre-verify source account balance before attempting ledger posting
    const currentSafeBalance = new Decimal(sourceAccount.currentBalance.toString());
    if (currentSafeBalance.lessThan(amountEgp)) {
      return NextResponse.json({
        error: `رصيد الصندوق النقدي (${sourceAccount.name}) لا يكفي. الرصيد الحالي: ${currentSafeBalance.toFixed(2)} EGP، والمطلوب صرفه: ${amountEgp.toLocaleString()} EGP`,
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

    // 2. Post Multi-currency Balancing Ledger Entries
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

    // Leg B: Disburse cash in EGP from Safe/Custody
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
          description: `صرف نقدي من ${sourceAccount.name}`,
        },
      ],
    });

    // 3. Create ExchangeTransaction Record
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
        employeeId: employeeId || null,
        createdBy: user.name,
        approvedBy: user.name,
        approvedAt: new Date(),
      },
    });

    // 4. Update Customer Session State
    const newDelivered = Number(session.deliveredAmount) + amountEgp;
    const requestedAmount = Number(session.requestedAmount);
    const nextStatus = newDelivered >= requestedAmount ? 'completed' : 'partially_delivered';

    const updatedSession = await prisma.customerSession.update({
      where: { id: session.id },
      data: {
        deliveredAmount: newDelivered,
        status: nextStatus,
        closedAt: nextStatus === 'completed' ? new Date() : null,
        closedBy: nextStatus === 'completed' ? user.name : null,
        payoutIdempotencyKey: idempotencyKey || null,
      },
      include: {
        customer: true,
        receipts: true,
        transactions: true,
      },
    });

    // 5. Generate Official Cash Payout Voucher (سند صرف نقدية رسمي)
    const voucherNumber = `VCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const voucher = await prisma.cashPayoutVoucher.create({
      data: {
        voucherNumber,
        customerSessionId: session.id,
        customerId: session.customerId,
        amount: amountEgp,
        currency: 'EGP',
        exchangeRate: exchangeRate,
        equivalentSdg: equivalentSdg,
        cashSourceAccountId: sourceAccount.id,
        paidBy: user.name,
        recipientName: recipientName || session.customer.name,
        notes: notes || 'صرف نقدية مستحقة مقابل حوالات بنكك معتمدة',
        status: 'issued',
      },
      include: {
        customer: true,
        customerSession: true,
      },
    });

    // 6. Record Audit Event
    const isExceptional = user.role === 'admin' && Number(session.receivedAmount) < Number(session.expectedAmount);
    await logAuditEvent({
      userId: user.userId,
      action: isExceptional ? 'EXCEPTIONAL_CASH_DELIVERY' : 'DELIVER_CUSTOMER_CASH',
      entityType: 'CustomerSession',
      entityId: session.id,
      newValues: {
        voucherNumber,
        amountEgp,
        equivalentSdg,
        sourceAccount: sourceAccount.name,
        status: nextStatus,
        performedByRole: user.role,
        isExceptional,
      },
      reason: isExceptional
        ? `صرف نقدية استثنائي جزئي معتمد من المدير العام (${notes}) بموجب السند ${voucherNumber}`
        : `تسليم نقدية بالجنيه المصري للعميل ${session.customer.name} بموجب السند ${voucherNumber}${notes ? ` - ملاحظات: ${notes}` : ''}`,
    });

    // 7. Dispatch Notification
    await createNotification({
      type: 'payout_completed',
      title: 'تم إكمال صرف النقدية للعميل',
      message: `تم صرف ${amountEgp.toLocaleString()} EGP للعميل ${session.customer.name} بموجب السند ${voucherNumber} من ${sourceAccount.name}`,
      referenceType: 'CashPayoutVoucher',
      referenceId: voucher.id,
      recipientRole: 'accountant',
      priority: 'high',
    });

    return NextResponse.json({
      success: true,
      message: 'تم تنفيذ عملية الصرف وإصدار سند الصرف النقدي بنجاح',
      data: {
        session: updatedSession,
        exchangeTransaction: exchangeTxn,
        voucher,
      },
    });
  } catch (error: any) {
    console.error('Error in cash delivery payout:', error);
    return NextResponse.json({ error: error.message || 'خطأ أثناء تنفيذ صرف النقدية' }, { status: 500 });
  }
}
