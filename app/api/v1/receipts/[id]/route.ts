import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const receipt = await prisma.bankakReceipt.findUnique({
      where: { id: params.id },
      include: {
        customer: true,
        customerSession: true,
      },
    });

    if (!receipt) {
      return NextResponse.json({ error: 'الإيصال غير موجود' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: receipt });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في جلب بيانات الإيصال' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const allowedRoles = ['admin', 'accountant', 'data_entry', 'bankak_auditor'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتعديل بيانات إيصالات بنكك. الصلاحية مقتصرة على المحاسب أو مدخل البيانات أو مدقق بنكك أو مدير النظام' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const {
      transactionId,
      amount,
      senderName,
      senderAccount,
      receiverName,
      receiverAccount,
      transactionDate,
      transactionTime,
      customerId,
      customerSessionId,
    } = body;

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "status", "transactionId", "amount", "senderName", "receiverName", "customerId", "customerSessionId" FROM "BankakReceipt" WHERE id = $1 FOR UPDATE',
        params.id
      );

      if (!locked || locked.length === 0) {
        throw new Error('الإيصال غير موجود');
      }

      const current = locked[0];

      if (current.status === 'approved') {
        throw new Error('لا يمكن تعديل إيصال تم اعتماده مالياً مسبقاً في الدفاتر المحاسبية');
      }

      if (current.status === 'rejected') {
        throw new Error('لا يمكن تعديل إيصال مرفوض مسبقاً');
      }

      // Check if transactionId changed, verify duplicate risk
      if (transactionId && transactionId.trim() !== current.transactionId) {
        const existingDuplicate = await tx.bankakReceipt.findFirst({
          where: {
            transactionId: transactionId.trim(),
            id: { not: params.id },
            status: { not: 'rejected' },
          },
        });
        if (existingDuplicate) {
          throw new Error(`رقم العملية (${transactionId}) مسجل مسبقاً في النظام بالإيصال ${existingDuplicate.receiptNumber}`);
        }
      }

      const updateData: any = {
        reviewedBy: user.name,
      };

      if (transactionId !== undefined && transactionId.trim()) {
        updateData.transactionId = transactionId.trim();
      }
      if (amount !== undefined) {
        const dAmount = new Decimal(amount);
        if (dAmount.isNegative() || dAmount.isZero()) {
          throw new Error('مبلغ الإيصال يجب أن يكون أكبر من الصفر');
        }
        updateData.amount = dAmount.toFixed(4);
      }
      if (senderName !== undefined) updateData.senderName = senderName ? senderName.trim() : null;
      if (senderAccount !== undefined) updateData.senderAccount = senderAccount ? senderAccount.trim() : null;
      if (receiverName !== undefined) updateData.receiverName = receiverName ? receiverName.trim() : null;
      if (receiverAccount !== undefined) updateData.receiverAccount = receiverAccount ? receiverAccount.trim() : null;
      if (transactionDate !== undefined) updateData.transactionDate = transactionDate;
      if (transactionTime !== undefined) updateData.transactionTime = transactionTime;
      if (customerId !== undefined) updateData.customerId = customerId || null;
      if (customerSessionId !== undefined) updateData.customerSessionId = customerSessionId || null;

      // Support re-processing OCR text on existing receipt
      if (body.reprocessOcr && current.ocrText) {
        const { parseBankakReceiptText } = await import('@/lib/ocr/bankak-parser');
        const reParsed = parseBankakReceiptText(current.ocrText);
        if (reParsed.transactionId) updateData.transactionId = reParsed.transactionId;
        if (reParsed.amount > 0) updateData.amount = new Decimal(reParsed.amount).toFixed(4);
        if (reParsed.senderName) updateData.senderName = reParsed.senderName;
        if (reParsed.receiverName) updateData.receiverName = reParsed.receiverName;
        if (reParsed.transactionDate) updateData.transactionDate = reParsed.transactionDate;
        updateData.ocrConfidence = reParsed.ocrConfidence;
      }

      const updated = await tx.bankakReceipt.update({
        where: { id: params.id },
        data: updateData,
        include: { customer: true, customerSession: true },
      });

      return { oldValues: current, updated };
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_BANKAK_RECEIPT',
      entityType: 'BankakReceipt',
      entityId: params.id,
      oldValues: result.oldValues,
      newValues: {
        transactionId: result.updated.transactionId,
        amount: result.updated.amount,
        senderName: result.updated.senderName,
        reviewedBy: user.name,
      },
      reason: `تعديل يدوي لبيانات إيصال بنكك بواسطة ${user.name}`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم تحديث بيانات الإيصال بنجاح',
      data: result.updated,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تعديل الإيصال' }, { status: 400 });
  }
}
