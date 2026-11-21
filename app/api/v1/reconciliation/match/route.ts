import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية مطابقة كشف الحساب مقتصرة على المحاسب أو مدير النظام' }, { status: 403 });
  }

  try {
    const { statementId } = await req.json();

    if (!statementId) {
      return NextResponse.json({ error: 'معرف كشف الحساب statementId مطلوب' }, { status: 400 });
    }

    const statement = await prisma.bankStatement.findUnique({
      where: { id: statementId },
      include: { lines: true },
    });

    if (!statement) {
      return NextResponse.json({ error: 'كشف الحساب غير موجود' }, { status: 404 });
    }

    // Fetch all receipts
    const receipts = await prisma.bankakReceipt.findMany();

    let matchedCount = 0;
    let unmatchedCount = 0;
    let mismatchCount = 0;
    let suspiciousCount = 0;

    for (const line of statement.lines) {
      const lineTxnId = line.transactionId?.trim().toLowerCase();
      const lineAmount = Number(line.amount);

      // Exact Transaction ID search
      const exactReceipt = receipts.find(
        (r) => r.transactionId?.trim().toLowerCase() === lineTxnId
      );

      if (exactReceipt) {
        const receiptAmount = Number(exactReceipt.amount);
        const amountDiff = Math.abs(receiptAmount - lineAmount);

        if (amountDiff < 0.01) {
          // Full Match
          await prisma.bankStatementLine.update({
            where: { id: line.id },
            data: {
              matchStatus: 'matched',
              matchedReceiptId: exactReceipt.id,
              matchedAt: new Date(),
              matchedBy: user.name,
              notes: `تطابق تام مع الإيصال رقم ${exactReceipt.receiptNumber}`,
            },
          });
          matchedCount++;
        } else {
          // Amount Mismatch
          await prisma.bankStatementLine.update({
            where: { id: line.id },
            data: {
              matchStatus: 'amount_mismatch',
              matchedReceiptId: exactReceipt.id,
              notes: `اختلاف مالي: مبلغ البنك (${lineAmount.toLocaleString()} SDG) يختلف عن الإيصال (${receiptAmount.toLocaleString()} SDG)`,
            },
          });
          mismatchCount++;
        }
      } else {
        // Check for Heuristic/Suspicious candidate (same amount, same date)
        const candidate = receipts.find(
          (r) =>
            Math.abs(Number(r.amount) - lineAmount) < 0.01 &&
            r.transactionDate === line.transactionDate
        );

        if (candidate) {
          await prisma.bankStatementLine.update({
            where: { id: line.id },
            data: {
              matchStatus: 'suspicious',
              matchedReceiptId: candidate.id,
              notes: `اشتباه تطابق مع الإيصال ${candidate.receiptNumber} لنفس التاريخ والمبلغ مع اختلاف رقم العملية`,
            },
          });
          suspiciousCount++;
        } else {
          await prisma.bankStatementLine.update({
            where: { id: line.id },
            data: {
              matchStatus: 'unmatched',
              notes: 'حركة بنكية واردة غير مقيدة بأي إيصال في المنصة',
            },
          });
          unmatchedCount++;
        }
      }
    }

    // Update Statement Stats
    const updatedStatement = await prisma.bankStatement.update({
      where: { id: statementId },
      data: {
        matchedLines: matchedCount,
        unmatchedLines: unmatchedCount + mismatchCount + suspiciousCount,
        status: 'reconciled',
      },
      include: {
        lines: true,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'RECONCILE_BANK_STATEMENT',
      entityType: 'BankStatement',
      entityId: statementId,
      newValues: { matchedCount, unmatchedCount, mismatchCount, suspiciousCount },
      reason: `تشغيل محرك مطابقة كشف الحساب البنكي رقم ${statement.statementNumber}`,
    });

    return NextResponse.json({
      success: true,
      message: `اكتملت المطابقة: ${matchedCount} مطابق، ${mismatchCount} اختلاف مبالغ، ${suspiciousCount} مشتبه به، ${unmatchedCount} غير مطابق`,
      data: updatedStatement,
      summary: {
        total: statement.lines.length,
        matched: matchedCount,
        mismatched: mismatchCount,
        suspicious: suspiciousCount,
        unmatched: unmatchedCount,
      },
    });
  } catch (error: any) {
    console.error('Error matching bank statement:', error);
    return NextResponse.json({ error: error.message || 'خطأ أثناء مطابقة كشف الحساب' }, { status: 500 });
  }
}
