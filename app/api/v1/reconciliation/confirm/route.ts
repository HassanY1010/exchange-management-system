import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية اعتماد المطابقة البنكية مقتصرة على المحاسب أو مدير النظام' },
      { status: 403 }
    );
  }

  try {
    const { statementId } = await req.json();

    if (!statementId) {
      return NextResponse.json({ error: 'معرف كشف الحساب مطلوب' }, { status: 400 });
    }

    const statement = await prisma.bankStatement.findUnique({
      where: { id: statementId },
      include: {
        lines: {
          where: { matchStatus: 'matched' },
        },
      },
    });

    if (!statement) {
      return NextResponse.json({ error: 'كشف الحساب غير موجود' }, { status: 404 });
    }

    // Idempotency: If already confirmed, return current state safely without duplicate processing
    if (statement.status === 'confirmed') {
      return NextResponse.json({
        success: true,
        message: 'كشف الحساب معتمد مسبقاً بالفعل',
        data: statement,
      });
    }

    // Collect distinct matched receipt IDs
    const matchedReceiptIds = Array.from(
      new Set(
        statement.lines
          .map((l) => l.matchedReceiptId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    // Atomic execution via transaction
    const { updatedStatement, verifiedCount } = await prisma.$transaction(async (tx) => {
      let count = 0;

      if (matchedReceiptIds.length > 0) {
        // Find receipts that are clean and not approved, rejected, duplicate, or suspicious
        const pendingReceipts = await tx.bankakReceipt.findMany({
          where: {
            id: { in: matchedReceiptIds },
            status: { notIn: ['approved', 'rejected', 'duplicate', 'failed'] },
            isSuspicious: false,
          },
          select: { id: true, status: true },
        });

        if (pendingReceipts.length > 0) {
          const idsToUpgrade = pendingReceipts.map((r) => r.id);
          const updateResult = await tx.bankakReceipt.updateMany({
            where: { id: { in: idsToUpgrade } },
            data: {
              status: 'verified',
              verifiedBy: user.name,
              verifiedAt: new Date(),
              verificationSource: 'bank_statement',
              verificationNotes: `تم التحقق آلياً عبر كشف حساب بنكك رقم ${statement.statementNumber}`,
            },
          });
          count = updateResult.count;
        }
      }

      // Mark statement as confirmed
      const confirmed = await tx.bankStatement.update({
        where: { id: statementId },
        data: { status: 'confirmed' },
        include: { lines: true },
      });

      return { updatedStatement: confirmed, verifiedCount: count };
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CONFIRM_BANK_RECONCILIATION',
      entityType: 'BankStatement',
      entityId: statementId,
      newValues: {
        confirmedMatchedLines: statement.lines.length,
        receiptsAutoVerified: verifiedCount,
      },
      reason: `تأكيد واعتماد مطابقة كشف الحساب البنكي رقم ${statement.statementNumber}`,
    });

    await createNotification({
      type: 'receipt_verified',
      title: 'تم اعتماد مطابقة كشف الحساب البنكي',
      message: `تم اعتماد مطابقة كشف الحساب ${statement.statementNumber} وتأكيد وصول ${statement.lines.length} حركة بنكية`,
      referenceType: 'BankStatement',
      referenceId: statement.id,
      recipientRole: 'accountant',
      priority: 'high',
    });

    return NextResponse.json({
      success: true,
      message: `تم اعتماد المطابقة البنكية بنجاح. تم التحقق من ${verifiedCount} إيصال ونقلها إلى Verified دون تكرار أي قيود مالية`,
      data: updatedStatement,
    });
  } catch (error: any) {
    console.error('Error confirming reconciliation:', error);
    return NextResponse.json(
      { error: error.message || 'خطأ في اعتماد المطابقة البنكية' },
      { status: 500 }
    );
  }
}
