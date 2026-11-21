import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

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

  try {
    const { name, description } = await req.json();
    if (!name) return NextResponse.json({ error: 'اسم التصنيف مطلوب' }, { status: 400 });

    const category = await prisma.expenseCategory.create({
      data: { name, description, status: 'active' },
    });

    return NextResponse.json({ success: true, data: category }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء التصنيف' }, { status: 500 });
  }
}
