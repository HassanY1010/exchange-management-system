import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can reject expenses
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك برفض المصروفات. الصلاحية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  const { id } = params;
  if (!id) return NextResponse.json({ error: 'معرف المصروف مطلوب' }, { status: 400 });

  let reason = '';
  try {
    const body = await req.json().catch(() => ({}));
    reason = body.reason || '';
  } catch {
    reason = '';
  }

  try {
    const expense = await prisma.expense.findFirst({
      where: {
        OR: [{ id }, { expenseNumber: id }],
      },
      include: { category: true },
    });

    if (!expense) {
      return NextResponse.json({ error: 'المصروف المطلوب رفضه غير موجود' }, { status: 404 });
    }

    if (expense.status === 'approved') {
      return NextResponse.json(
        { error: 'لا يمكن رفض مصروف تم اعتماده وصرفه بالفعل. يجب استخدام خاصية الإلغاء والعكس المحاسبي' },
        { status: 400 }
      );
    }

    if (expense.status === 'rejected' || expense.status === 'cancelled') {
      return NextResponse.json({ error: 'هذا المصروف مرفوض أو ملغي مسبقاً' }, { status: 400 });
    }

    // Update status to rejected with zero financial impact
    const updatedExpense = await prisma.expense.update({
      where: { id: expense.id },
      data: {
        status: 'rejected',
        description: `${expense.description} [مرفوض: ${reason || 'بواسطة ' + (user.name || user.email)}]`,
      },
      include: { category: true },
    });

    // Record Audit Log
    await logAuditEvent({
      userId: user.userId,
      action: 'REJECT_EXPENSE',
      entityType: 'Expense',
      entityId: expense.id,
      oldValues: { status: 'pending' },
      newValues: { status: 'rejected', rejectedBy: user.name || user.email },
      reason: reason || `رفض المصروف المعلق: ${expense.expenseNumber}`,
    });

    return NextResponse.json({
      success: true,
      message: `تم رفض المصروف ${expense.expenseNumber} وإلغاء طلبه دون أي أثر محاسبي أو مالي على الخزائن`,
      data: {
        ...updatedExpense,
        amount: Number(updatedExpense.amount),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ أثناء رفض المصروف' }, { status: 500 });
  }
}
