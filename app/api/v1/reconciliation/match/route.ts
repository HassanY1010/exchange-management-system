import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import { runBankReconciliationMatching } from '@/lib/reconciliation/matching-engine';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية مطابقة كشف الحساب مقتصرة على المحاسب أو مدير النظام' },
      { status: 403 }
    );
  }

  try {
    const { statementId } = await req.json();

    if (!statementId) {
      return NextResponse.json(
        { error: 'معرف كشف الحساب statementId مطلوب' },
        { status: 400 }
      );
    }

    const result = await runBankReconciliationMatching(statementId, {
      userId: user.userId,
      name: user.name,
      role: user.role,
    });

    return NextResponse.json({
      success: true,
      message: result.message,
      data: result.updatedStatement,
      summary: result.summary,
    });
  } catch (error: any) {
    console.error('Error matching bank statement:', error);
    return NextResponse.json(
      { error: error.message || 'خطأ أثناء مطابقة كشف الحساب' },
      { status: 500 }
    );
  }
}
