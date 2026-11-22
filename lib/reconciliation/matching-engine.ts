import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';

export interface MatchingSummary {
  total: number;
  matched: number;
  mismatched: number;
  suspicious: number;
  multipleCandidates: number;
  duplicate: number;
  unmatched: number;
  totalAmountSDG: number;
  matchedAmountSDG: number;
  unmatchedAmountSDG: number;
}

export interface MatchingResult {
  success: boolean;
  message: string;
  statementId: string;
  summary: MatchingSummary;
  updatedStatement: any;
}

/**
 * Robust, production-grade Bank Reconciliation Matching Engine
 * Enforces exact TXN priority, strict amount parity, duplicate detection across statements,
 * prevents auto-matching on multi-candidate ambiguities, and guarantees atomic execution.
 */
export async function runBankReconciliationMatching(
  statementId: string,
  user: { userId: string; name: string; role: string }
): Promise<MatchingResult> {
  const statement = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { lines: true },
  });

  if (!statement) {
    throw new Error('كشف الحساب البنكي غير موجود');
  }

  if (statement.lines.length === 0) {
    throw new Error('كشف الحساب لا يحتوي على أي حركات بنكية للفحص');
  }

  // 1. Extract statement metadata & bounds for targeted query
  const lineTxns = statement.lines
    .map((l) => l.transactionId?.trim().toLowerCase())
    .filter(Boolean);

  const dates = statement.lines
    .map((l) => l.transactionDate)
    .filter((d) => d && d.length === 10)
    .sort();

  const minDate = dates[0] || '1970-01-01';
  const maxDate = dates[dates.length - 1] || '2099-12-31';

  // 2. Query only relevant receipts (targeted query, zero memory leak)
  const receipts = await prisma.bankakReceipt.findMany({
    where: {
      OR: [
        { transactionId: { in: statement.lines.map((l) => l.transactionId) } },
        { transactionDate: { gte: minDate, lte: maxDate } },
      ],
    },
    select: {
      id: true,
      receiptNumber: true,
      transactionId: true,
      amount: true,
      transactionDate: true,
      senderName: true,
      status: true,
      isSuspicious: true,
      duplicateOfId: true,
      customerId: true,
      customerSessionId: true,
    },
  });

  // 3. Query other statements to detect cross-statement duplicates
  const otherStatementLines = await prisma.bankStatementLine.findMany({
    where: {
      statementId: { not: statementId },
      matchStatus: { in: ['matched', 'confirmed'] },
      transactionId: { in: statement.lines.map((l) => l.transactionId) },
    },
    select: {
      transactionId: true,
      statementId: true,
    },
  });

  const previouslyReconciledTxns = new Set(
    otherStatementLines.map((l) => l.transactionId.trim().toLowerCase())
  );

  // 4. Track intra-file TXN frequency
  const txnCountsInFile = new Map<string, number>();
  for (const line of statement.lines) {
    const key = line.transactionId?.trim().toLowerCase();
    if (key) {
      txnCountsInFile.set(key, (txnCountsInFile.get(key) || 0) + 1);
    }
  }

  const matchedReceiptIdsInRun = new Set<string>();
  const updates: Array<{
    id: string;
    matchStatus: string;
    matchedReceiptId: string | null;
    matchedAt: Date | null;
    matchedBy: string | null;
    notes: string;
  }> = [];

  const summary: MatchingSummary = {
    total: statement.lines.length,
    matched: 0,
    mismatched: 0,
    suspicious: 0,
    multipleCandidates: 0,
    duplicate: 0,
    unmatched: 0,
    totalAmountSDG: 0,
    matchedAmountSDG: 0,
    unmatchedAmountSDG: 0,
  };

  // 5. Evaluate matching tiers
  for (const line of statement.lines) {
    const lineTxn = line.transactionId?.trim().toLowerCase() || '';
    const lineAmount = Number(line.amount);
    summary.totalAmountSDG += lineAmount;

    // Check intra-statement duplication
    if ((txnCountsInFile.get(lineTxn) || 0) > 1) {
      updates.push({
        id: line.id,
        matchStatus: 'duplicate',
        matchedReceiptId: null,
        matchedAt: null,
        matchedBy: user.name,
        notes: `تكرار: رقم العملية (${line.transactionId}) مكرر أكثر من مرة في كشف الحساب`,
      });
      summary.duplicate++;
      summary.unmatchedAmountSDG += lineAmount;
      continue;
    }

    // Check cross-statement prior reconciliation
    if (previouslyReconciledTxns.has(lineTxn)) {
      updates.push({
        id: line.id,
        matchStatus: 'duplicate',
        matchedReceiptId: null,
        matchedAt: null,
        matchedBy: user.name,
        notes: `تكرار سابق: رقم العملية (${line.transactionId}) تم استيراده ومطابقته مسبقاً في كشف حساب آخر`,
      });
      summary.duplicate++;
      summary.unmatchedAmountSDG += lineAmount;
      continue;
    }

    // Exact TXN match lookup
    const exactReceipt = receipts.find(
      (r) => r.transactionId?.trim().toLowerCase() === lineTxn
    );

    if (exactReceipt) {
      const receiptAmount = Number(exactReceipt.amount);
      const amountDiff = Math.abs(receiptAmount - lineAmount);

      if (amountDiff < 0.01) {
        // Check if receipt is already rejected
        if (exactReceipt.status === 'rejected') {
          updates.push({
            id: line.id,
            matchStatus: 'conflict',
            matchedReceiptId: exactReceipt.id,
            matchedAt: new Date(),
            matchedBy: user.name,
            notes: `تعارض مالي: رقم العملية مطابق للإيصال ${exactReceipt.receiptNumber} ولكن الإيصال مرفوض في المنصة`,
          });
          summary.mismatched++;
          summary.unmatchedAmountSDG += lineAmount;
          continue;
        }

        // Check if receipt already matched to another line in this run
        if (matchedReceiptIdsInRun.has(exactReceipt.id)) {
          updates.push({
            id: line.id,
            matchStatus: 'duplicate',
            matchedReceiptId: exactReceipt.id,
            matchedAt: null,
            matchedBy: user.name,
            notes: `تكرار: الإيصال ${exactReceipt.receiptNumber} ارتبط بالفعل بحركة بنكية سابقة في هذا الكشف`,
          });
          summary.duplicate++;
          summary.unmatchedAmountSDG += lineAmount;
          continue;
        }

        // Full Confirmed Match
        updates.push({
          id: line.id,
          matchStatus: 'matched',
          matchedReceiptId: exactReceipt.id,
          matchedAt: new Date(),
          matchedBy: user.name,
          notes:
            exactReceipt.status === 'approved'
              ? `تطابق تام مؤكد مع إيصال معتمد مسبقاً (${exactReceipt.receiptNumber})`
              : `تطابق تام مؤكد مع إيصال مسجل بالمنصة (${exactReceipt.receiptNumber})`,
        });
        matchedReceiptIdsInRun.add(exactReceipt.id);
        summary.matched++;
        summary.matchedAmountSDG += lineAmount;
      } else {
        // Amount Mismatch
        updates.push({
          id: line.id,
          matchStatus: 'amount_mismatch',
          matchedReceiptId: exactReceipt.id,
          matchedAt: new Date(),
          matchedBy: user.name,
          notes: `اختلاف مالي: مبلغ البنك (${lineAmount.toLocaleString()} SDG) يختلف عن مبلغ الإيصال ${exactReceipt.receiptNumber} (${receiptAmount.toLocaleString()} SDG)`,
        });
        summary.mismatched++;
        summary.unmatchedAmountSDG += lineAmount;
      }
    } else {
      // Probabilistic Candidates (Same Amount & Same Date)
      const candidates = receipts.filter(
        (r) =>
          Math.abs(Number(r.amount) - lineAmount) < 0.01 &&
          r.transactionDate === line.transactionDate &&
          !matchedReceiptIdsInRun.has(r.id)
      );

      if (candidates.length === 1) {
        // Single candidate -> Suspicious (Requires Review)
        const cand = candidates[0];
        updates.push({
          id: line.id,
          matchStatus: 'suspicious',
          matchedReceiptId: cand.id,
          matchedAt: new Date(),
          matchedBy: user.name,
          notes: `اشتباه تطابق مع الإيصال ${cand.receiptNumber} لنفس التاريخ والمبلغ مع اختلاف رقم العملية (يتطلب مراجعة بشرية)`,
        });
        summary.suspicious++;
        summary.unmatchedAmountSDG += lineAmount;
      } else if (candidates.length > 1) {
        // Multiple candidates -> Never auto-match! Must require review
        updates.push({
          id: line.id,
          matchStatus: 'multiple_candidates',
          matchedReceiptId: null,
          matchedAt: null,
          matchedBy: user.name,
          notes: `تعارض مرشحين: يوجد ${candidates.length} إيصالات بنفس التاريخ والمبلغ - لا يمكن المطابقة آلياً دون تدقيق`,
        });
        summary.multipleCandidates++;
        summary.unmatchedAmountSDG += lineAmount;
      } else {
        // Unmatched (Not registered in platform)
        updates.push({
          id: line.id,
          matchStatus: 'unmatched',
          matchedReceiptId: null,
          matchedAt: null,
          matchedBy: user.name,
          notes: 'حركة بنكية واردة غير مسجلة بأي إيصال في المنصة',
        });
        summary.unmatched++;
        summary.unmatchedAmountSDG += lineAmount;
      }
    }
  }

  // 6. Execute atomic batch update transaction
  const [updatedStatement] = await prisma.$transaction([
    prisma.bankStatement.update({
      where: { id: statementId },
      data: {
        matchedLines: summary.matched,
        unmatchedLines:
          summary.unmatched +
          summary.mismatched +
          summary.suspicious +
          summary.multipleCandidates +
          summary.duplicate,
        status: 'reconciled',
      },
      include: { lines: true },
    }),
    ...updates.map((u) =>
      prisma.bankStatementLine.update({
        where: { id: u.id },
        data: {
          matchStatus: u.matchStatus,
          matchedReceiptId: u.matchedReceiptId,
          matchedAt: u.matchedAt,
          matchedBy: u.matchedBy,
          notes: u.notes,
        },
      })
    ),
  ]);

  // 7. Audit Log recording
  await logAuditEvent({
    userId: user.userId,
    action: 'RECONCILE_BANK_STATEMENT',
    entityType: 'BankStatement',
    entityId: statementId,
    newValues: {
      matched: summary.matched,
      mismatched: summary.mismatched,
      suspicious: summary.suspicious,
      multipleCandidates: summary.multipleCandidates,
      duplicate: summary.duplicate,
      unmatched: summary.unmatched,
    },
    reason: `تشغيل محرك مطابقة كشف الحساب البنكي رقم ${statement.statementNumber}`,
  });

  return {
    success: true,
    message: `اكتملت المطابقة: ${summary.matched} تطابق تام، ${summary.suspicious} اشتباه فردي، ${summary.multipleCandidates} مرشحين متعددين، ${summary.mismatched} اختلاف مالي، ${summary.duplicate} مكرر، ${summary.unmatched} غير مسجل`,
    statementId,
    summary,
    updatedStatement,
  };
}
