import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Any verified personnel can record bank account verification
  const allowedRoles = ['admin', 'accountant', 'data_entry', 'custody_officer', 'bankak_auditor'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: 'غير مصرح لك بتنفيذ التحقق البنكي من الإيصالات' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      verificationSource = 'mobile_app', // mobile_app | bank_statement | teller_confirmation | official_api
      verificationBankAccountId,
      verificationNotes,
    } = body;

    // Atomic row-level lock and state verification
    const verifiedReceipt = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "status", "amount", "transactionId", "customerId", "customerSessionId" FROM "BankakReceipt" WHERE id = $1 FOR UPDATE',
        params.id
      );

      if (!locked || locked.length === 0) {
        throw new Error('الإيصال المطلوب غير موجود');
      }

      const currentStatus = locked[0].status;

      if (currentStatus === 'approved') {
        throw new Error('الإيصال تم اعتماده مالياً مسبقاً ولا يتطلب إعادة تحقق');
      }
      if (currentStatus === 'duplicate') {
        throw new Error('لا يمكن التحقق من إيصال مصنف كمكرر في النظام');
      }
      if (currentStatus === 'rejected') {
        throw new Error('لا يمكن التحقق من إيصال مرفوض مسبقاً');
      }

      const updated = await tx.bankakReceipt.update({
        where: { id: params.id },
        data: {
          status: 'verified',
          verifiedBy: user.name,
          verifiedAt: new Date(),
          verificationSource,
          verificationBankAccountId: verificationBankAccountId || null,
          verificationNotes: verificationNotes || 'تم تأكيد وصول الحوالة في الحساب البنكي',
        },
        include: {
          customer: true,
          customerSession: true,
        },
      });

      // Record audit event inside atomic transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'VERIFY_BANKAK_RECEIPT',
        entityType: 'BankakReceipt',
        entityId: updated.id,
        oldValues: { status: 'pending_review' },
        newValues: {
          status: 'verified',
          verifiedBy: user.name,
          verificationSource,
          notes: verificationNotes,
        },
        reason: `التحقق من وصول الحوالة البنكية رقم ${updated.transactionId}`,
        tx,
      });

      return updated;
    });

    // Send targeted notification to accountant for financial approval
    await createNotification({
      type: 'receipt_verified',
      title: 'إيصال بنكك تم التحقق منه وجاهز للاعتماد المالي',
      message: `تم التحقق من وصول مبلغ ${Number(verifiedReceipt.amount).toLocaleString()} SDG (رقم العملية: ${verifiedReceipt.transactionId}) بواسطة ${user.name}. الإيصال بانتظار الاعتماد المالي وتسجيل القيد`,
      referenceType: 'BankakReceipt',
      referenceId: verifiedReceipt.id,
      recipientRole: 'accountant',
      priority: 'high',
    });

    return NextResponse.json({
      success: true,
      message: 'تم تأكيد التحقق من وصول الحوالة بنجاح، والإيصال جاهز للاعتماد المالي',
      data: verifiedReceipt,
    });
  } catch (error: any) {
    console.error('Error verifying receipt:', error);
    return NextResponse.json({ error: error.message || 'خطأ في عملية التحقق البنكي' }, { status: 400 });
  }
}
