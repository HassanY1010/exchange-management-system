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

    // 1. Fully Atomic Concurrency Lock, Validation, Ledger Posting & Voucher Issuance
    const result = await prisma.$transaction(async (tx) => {
      const lockedSessionRows = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "status", "requestedAmount", "expectedAmount", "receivedAmount", "deliveredAmount", "exchangeRate", "customerId", "sessionNumber", "payoutIdempotencyKey", "overpaymentAmount", "overpaymentSettled" FROM "CustomerSession" WHERE id = $1 FOR UPDATE',
        params.id
      );

      if (!lockedSessionRows || lockedSessionRows.length === 0) {
        throw new Error('الجلسة الحسابية غير موجودة');
      }

      const locked = lockedSessionRows[0];

      // Idempotency: If request with same idempotencyKey was already fulfilled, return existing state
      if (idempotencyKey && locked.payoutIdempotencyKey === idempotencyKey && (locked.status === 'completed' || Number(locked.deliveredAmount) > 0)) {
        const existingVoucher = await tx.cashPayoutVoucher.findFirst({
          where: { customerSessionId: locked.id },
          include: { customer: true, customerSession: true },
          orderBy: { createdAt: 'desc' },
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
      if (received.lessThan(expected.minus(0.0001))) {
        if (!allowPartial || user.role !== 'admin') {
          throw new Error(
            `لا يمكن صرف النقدية للعميل قبل استيفاء واعتماد كامل إيصالات بنكك المطلوبة. المعتمد حالياً: ${received.toFixed(2)} SDG، والمطلوب: ${expected.toFixed(2)} SDG`
          );
        }
        if (!notes || notes.trim().length < 5) {
          throw new Error('يجب تقديم سبب توثيقي إلزامي (لا يقل عن 5 أحرف) لتجاوز الصرف الاستثنائي الجزئي بواسطة المدير العام');
        }
      }

      const amountEgp = Number(body.amountEgp || locked.requestedAmount);
      if (isNaN(amountEgp) || amountEgp <= 0) {
        throw new Error('المبلغ المسلم يجب أن يكون رقماً أكبر من الصفر');
      }

      // Check remaining EGP: Prevent over-delivery beyond requested session amount
      const remainingEgp = new Decimal(locked.requestedAmount.toString()).minus(locked.deliveredAmount.toString());
      if (new Decimal(amountEgp).greaterThan(remainingEgp.plus(0.0001))) {
        throw new Error(
          `المبلغ المطلوب صرفه (${amountEgp.toLocaleString()} EGP) يتجاوز الرصيد المتبقي للتسليم في هذه الجلسة (${remainingEgp.toFixed(2)} EGP)`
        );
      }

      // Determine cash delivery source account (safe 1010 or specific custody)
      let targetAccountId = accountId;
      if (!targetAccountId) {
        const defaultSafe = await tx.account.findFirst({
          where: { accountCode: '1010' },
          select: { id: true },
        });
        if (!defaultSafe) {
          throw new Error('حساب الصندوق النقدي المصري (1010) غير مهيأ في الدليل');
        }
        targetAccountId = defaultSafe.id;
      }

      // Explicit row-level lock on the Cash Account across ALL concurrent sessions to prevent over-drafting the safe
      const lockedAccountRows = (await tx.$queryRawUnsafe(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
        targetAccountId
      )) as any[];

      if (!lockedAccountRows || lockedAccountRows.length === 0) {
        throw new Error('حساب الصندوق النقدي غير موجود');
      }

      const sourceAccount = lockedAccountRows[0];

      if (sourceAccount.currency !== 'EGP') {
        throw new Error(`حساب الصرف النقدي (${sourceAccount.name}) يجب أن يكون بالجنيه المصري (EGP)، بينما حسابه بالـ (${sourceAccount.currency})`);
      }

      // Pre-verify source account balance from the freshly locked row
      const currentSafeBalance = new Decimal(sourceAccount.currentBalance.toString());
      if (currentSafeBalance.lessThan(amountEgp)) {
        throw new Error(
          `رصيد الصندوق النقدي (${sourceAccount.name}) لا يكفي. الرصيد الحالي: ${currentSafeBalance.toFixed(2)} EGP، والمطلوب صرفه: ${amountEgp.toLocaleString()} EGP`
        );
      }

      const customerLiabilityAccount = await tx.account.findFirst({
        where: { accountCode: '2010' },
      });

      if (!customerLiabilityAccount) {
        throw new Error('حساب وسيط التزامات العملاء (2010) غير مهيأ في الدليل');
      }

      const customer = await tx.customer.findUnique({ where: { id: locked.customerId } });
      const customerName = customer ? customer.name : 'العميل';

      const exchangeRate = Number(locked.exchangeRate);
      const equivalentSdg = new Decimal(amountEgp).times(exchangeRate).toNumber();

      // 2. Post Multi-currency Balancing Ledger Entries inside the same Transaction (tx)
      const customerLiabilitySdg = await tx.account.findFirst({ where: { accountCode: '2015' } });
      const currencyClearingSdg = await tx.account.findFirst({ where: { accountCode: '1065' } });

      if (customerLiabilitySdg && currencyClearingSdg) {
        await postLedgerTransaction({
          entryType: 'currency_exchange_sdg_clear',
          referenceType: 'CustomerSession',
          referenceId: locked.id,
          description: `تسوية التزام العميل بالسوداني ${equivalentSdg.toLocaleString()} SDG لجلسة ${locked.sessionNumber}`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: customerLiabilitySdg.id,
              currency: 'SDG',
              debit: equivalentSdg,
              credit: 0,
              description: `تسوية التزام العميل ${customerName}`,
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
        referenceId: locked.id,
        description: `تسليم نقدي ${amountEgp.toLocaleString()} EGP للعميل ${customerName} (جلسة ${locked.sessionNumber})`,
        createdBy: user.name,
        tx,
        lines: [
          {
            accountId: customerLiabilityAccount.id,
            currency: 'EGP',
            debit: amountEgp,
            credit: 0,
            description: `تسوية التزام العميل ${customerName}`,
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
      const txnNumber = `TXN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const exchangeTxn = await tx.exchangeTransaction.create({
        data: {
          transactionNumber: txnNumber,
          customerId: locked.customerId,
          customerSessionId: locked.id,
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

      // 4. Update Customer Session State atomically
      const newDelivered = Number(locked.deliveredAmount) + amountEgp;
      const requestedAmount = Number(locked.requestedAmount);
      const isNowFullyDelivered = newDelivered >= requestedAmount;
      const isNowFullyPaid = new Decimal(locked.receivedAmount.toString()).greaterThanOrEqualTo(new Decimal(locked.expectedAmount.toString()).minus(0.0001));
      const hasUnsettledOverpayment = Number(locked.overpaymentAmount || 0) > 0 && !locked.overpaymentSettled;

      // Only mark completed if fully delivered, fully paid, AND overpayment settled (if any)
      let nextStatus = 'partially_delivered';
      if (isNowFullyDelivered && isNowFullyPaid && !hasUnsettledOverpayment) {
        nextStatus = 'completed';
      } else if (isNowFullyDelivered && !isNowFullyPaid) {
        // Cash was delivered (exceptional payout), but receipts are still pending
        nextStatus = 'pending_receipts';
      } else if (!isNowFullyDelivered && isNowFullyPaid) {
        // Receipts are complete, but cash was only partially delivered
        nextStatus = 'partially_delivered';
      } else if (hasUnsettledOverpayment) {
        // Both paid and delivered, but excess surplus requires settlement first
        nextStatus = 'pending_delivery';
      } else {
        nextStatus = 'partially_delivered';
      }

      const updatedSession = await tx.customerSession.update({
        where: { id: locked.id },
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
      const voucher = await tx.cashPayoutVoucher.create({
        data: {
          voucherNumber,
          customerSessionId: locked.id,
          customerId: locked.customerId,
          amount: amountEgp,
          currency: 'EGP',
          exchangeRate: exchangeRate,
          equivalentSdg: equivalentSdg,
          cashSourceAccountId: sourceAccount.id,
          paidBy: user.name,
          recipientName: recipientName || customerName,
          notes: notes || 'صرف نقدية مستحقة مقابل حوالات بنكك معتمدة',
          status: 'issued',
        },
        include: {
          customer: true,
          customerSession: true,
        },
      });

      const isExceptional = user.role === 'admin' && Number(locked.receivedAmount) < Number(locked.expectedAmount);

      return {
        isIdempotentReplay: false,
        session: updatedSession,
        exchangeTransaction: exchangeTxn,
        voucher,
        isExceptional,
        voucherNumber,
        amountEgp,
        equivalentSdg,
        sourceAccountName: sourceAccount.name,
        customerName,
        nextStatus,
      };
    });

    if (result.isIdempotentReplay) {
      return NextResponse.json({
        success: true,
        message: 'تم استرجاع إيصال الصرف المنفذ مسبقاً (Idempotent Request)',
        data: { session: result.session, voucher: result.voucher },
      });
    }

    const resData = result as any;

    // 6. Record Audit Event (Post-Transaction)
    await logAuditEvent({
      userId: user.userId,
      action: resData.isExceptional ? 'EXCEPTIONAL_CASH_DELIVERY' : 'DELIVER_CUSTOMER_CASH',
      entityType: 'CustomerSession',
      entityId: resData.session.id,
      newValues: {
        voucherNumber: resData.voucherNumber,
        amountEgp: resData.amountEgp,
        equivalentSdg: resData.equivalentSdg,
        sourceAccount: resData.sourceAccountName,
        status: resData.nextStatus,
        performedByRole: user.role,
        isExceptional: resData.isExceptional,
      },
      reason: resData.isExceptional
        ? `صرف نقدية استثنائي جزئي معتمد من المدير العام (${notes}) بموجب السند ${resData.voucherNumber}`
        : `تسليم نقدية بالجنيه المصري للعميل ${resData.customerName} بموجب السند ${resData.voucherNumber}${notes ? ` - ملاحظات: ${notes}` : ''}`,
    });

    // 7. Dispatch Notification
    await createNotification({
      type: 'payout_completed',
      title: 'تم إكمال صرف النقدية للعميل',
      message: `تم صرف ${resData.amountEgp.toLocaleString()} EGP للعميل ${resData.customerName} بموجب السند ${resData.voucherNumber} من ${resData.sourceAccountName}`,
      referenceType: 'CashPayoutVoucher',
      referenceId: resData.voucher.id,
      recipientRole: 'accountant',
      priority: 'high',
    });

    return NextResponse.json({
      success: true,
      message: 'تم تنفيذ عملية الصرف وإصدار سند الصرف النقدي بنجاح',
      data: {
        session: resData.session,
        exchangeTransaction: resData.exchangeTransaction,
        voucher: resData.voucher,
      },
    });
  } catch (error: any) {
    console.error('Error in cash delivery payout:', error);
    return NextResponse.json({ error: error.message || 'خطأ أثناء تنفيذ صرف النقدية' }, { status: 500 });
  }
}
