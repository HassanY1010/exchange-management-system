import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const categories = await prisma.expenseCategory.findMany({
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ success: true, data: categories });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية إضافة تصنيفات المصروفات مخصصة للمحاسب أو مدير النظام فقط' }, { status: 403 });
  }

  try {
    const { name, description } = await req.json();
    if (!name || !name.trim()) return NextResponse.json({ error: 'اسم التصنيف مطلوب' }, { status: 400 });

    const category = await prisma.expenseCategory.create({
      data: { name: name.trim(), description: description?.trim() || null, status: 'active' },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_EXPENSE_CATEGORY',
      entityType: 'ExpenseCategory',
      entityId: category.id,
      newValues: { name: category.name, description: category.description },
      reason: `إنشاء تصنيف مصروف جديد (${category.name})`,
    });

    return NextResponse.json({ success: true, data: category }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء التصنيف' }, { status: 500 });
  }
}
