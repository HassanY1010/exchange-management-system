import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant', 'bankak_auditor'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بعرض كشوفات الحساب والمطابقة البنكية' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const statementId = searchParams.get('statementId');
  const statusFilter = searchParams.get('status');
  const search = searchParams.get('search')?.trim();
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '25', 10)));

  // If a specific statement is requested with pagination / filtering
  if (statementId) {
    const statement = await prisma.bankStatement.findUnique({
      where: { id: statementId },
    });

    if (!statement) {
      return NextResponse.json({ error: 'كشف الحساب غير موجود' }, { status: 404 });
    }

    const lineWhere: any = { statementId };
    if (statusFilter) {
      lineWhere.matchStatus = statusFilter;
    }
    if (search) {
      lineWhere.OR = [
        { transactionId: { contains: search, mode: 'insensitive' } },
        { senderName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [totalLinesCount, lines, statsRaw] = await Promise.all([
      prisma.bankStatementLine.count({ where: lineWhere }),
      prisma.bankStatementLine.findMany({
        where: lineWhere,
        orderBy: [{ matchStatus: 'asc' }, { transactionDate: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bankStatementLine.groupBy({
        by: ['matchStatus', 'currency'],
        where: { statementId },
        _count: { id: true },
        _sum: { amount: true },
      }),
    ]);

    const primaryCurrency = lines[0]?.currency || 'SDG';

    const stats = {
      total: statement.totalLines,
      currency: primaryCurrency,
      matchedCount: 0,
      matchedAmount: 0,
      mismatchCount: 0,
      mismatchAmount: 0,
      suspiciousCount: 0,
      suspiciousAmount: 0,
      duplicateCount: 0,
      duplicateAmount: 0,
      unmatchedCount: 0,
      unmatchedAmount: 0,
      // Net genuine volume excluding duplicate movements
      netTotalAmount: 0,
      grossTotalAmount: 0,
      byCurrency: {} as Record<string, { count: number; sum: number }>,
    };

    for (const group of statsRaw) {
      const count = group._count.id;
      const sum = Number(group._sum.amount || 0);
      const curr = group.currency || 'SDG';

      if (!stats.byCurrency[curr]) {
        stats.byCurrency[curr] = { count: 0, sum: 0 };
      }
      stats.byCurrency[curr].count += count;
      stats.byCurrency[curr].sum += sum;

      stats.grossTotalAmount += sum;
      if (group.matchStatus !== 'duplicate') {
        stats.netTotalAmount += sum;
      }

      switch (group.matchStatus) {
        case 'matched':
          stats.matchedCount += count;
          stats.matchedAmount += sum;
          break;
        case 'amount_mismatch':
        case 'conflict':
          stats.mismatchCount += count;
          stats.mismatchAmount += sum;
          break;
        case 'suspicious':
        case 'multiple_candidates':
          stats.suspiciousCount += count;
          stats.suspiciousAmount += sum;
          break;
        case 'duplicate':
          stats.duplicateCount += count;
          stats.duplicateAmount += sum;
          break;
        case 'unmatched':
        default:
          stats.unmatchedCount += count;
          stats.unmatchedAmount += sum;
          break;
      }
    }

    return NextResponse.json({
      success: true,
      statement,
      stats,
      data: lines,
      pagination: {
        page,
        pageSize,
        total: totalLinesCount,
        totalPages: Math.ceil(totalLinesCount / pageSize),
      },
    });
  }

  // Fetch statements summary list (without lines payload) for fast listing
  const statements = await prisma.bankStatement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({
    success: true,
    data: statements,
  });
}
