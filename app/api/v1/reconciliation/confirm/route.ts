import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية اعتماد المطابقة البنكية مقتصرة على المحاسب أو مدير النظام' }, { status: 403 });
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

    let verifiedCount = 0;

    // Upgrade matched unverified receipts to 'verified' status without creating duplicate ledger entries
    for (const line of statement.lines) {
      if (line.matchedReceiptId) {
        const receipt = await prisma.bankakReceipt.findUnique({
          where: { id: line.matchedReceiptId },
        });

        if (receipt && receipt.status !== 'approved' && receipt.status !== 'rejected') {
          await prisma.bankakReceipt.update({
            where: { id: receipt.id },
            data: {
              status: 'verified',
              verifiedBy: user.name,
              verifiedAt: new Date(),
              verificationSource: 'bank_statement',
              verificationNotes: `تم التحقق آلياً عبر كشف حساب بنكك رقم ${statement.statementNumber}`,
            },
          });
          verifiedCount++;
        }
      }
    }

    const updatedStatement = await prisma.bankStatement.update({
      where: { id: statementId },
      data: { status: 'confirmed' },
      include: { lines: true },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CONFIRM_BANK_RECONCILIATION',
      entityType: 'BankStatement',
      entityId: statementId,
      newValues: { confirmedMatchedLines: statement.lines.length, receiptsAutoVerified: verifiedCount },
      reason: `تأكيد واعتماد مطابقة كشف الحساب البنكي رقم ${statement.statementNumber}`,
    });

    await createNotification({
      type: 'receipt_verified',
      title: 'تم اعتماد مطابقة كشف الحساب البنكي',
      message: `تم اعتماد مطابقة كشف الحساب ${statement.statementNumber} وتأكيد وصول ${statement.lines.length} حوالة بنكية بنجاح`,
      referenceType: 'BankStatement',
      referenceId: statement.id,
      recipientRole: 'accountant',
      priority: 'high',
    });

    return NextResponse.json({
      success: true,
      message: `تم اعتماد المطابقة البنكية بنجاح. تم التحقق من ${verifiedCount} إيصال ونقلها إلى حالة Verified دون تكرار أي قيود مالية`,
      data: updatedStatement,
    });
  } catch (error: any) {
    console.error('Error confirming reconciliation:', error);
    return NextResponse.json({ error: error.message || 'خطأ في اعتماد المطابقة البنكية' }, { status: 500 });
  }
}
