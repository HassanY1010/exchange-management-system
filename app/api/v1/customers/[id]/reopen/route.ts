import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin can reopen a closed customer account
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'صلاحية إعادة فتح حساب العميل المقفل محصورة بمدير النظام فقط', success: false },
      { status: 403 }
    );
  }

  const customerId = params.id;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    return NextResponse.json({ error: 'العميل غير موجود في النظام', success: false }, { status: 404 });
  }

  if (customer.status !== 'closed') {
    return NextResponse.json(
      { error: `لا يمكن إعادة فتح الحساب لأن حالته الحالية هي (${customer.status}) وليس مقفلاً`, success: false },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { reason } = body;

  if (!reason || reason.trim().length < 5) {
    return NextResponse.json(
      { error: 'يرجى إدخال سبب رسمي ومفصل لإعادة فتح حساب العميل (5 أحرف على الأقل)', success: false },
      { status: 400 }
    );
  }

  const reopenReason = reason.trim();
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const updatedNote = customer.notes
    ? `${customer.notes}\n[${timestamp}] تم إعادة فتح الحساب من (closed) إلى (active) بواسطة مدير النظام (${user.name}). السبب: ${reopenReason}`
    : `[${timestamp}] تم إعادة فتح الحساب من (closed) إلى (active) بواسطة مدير النظام (${user.name}). السبب: ${reopenReason}`;

  const updatedCustomer = await prisma.$transaction(async (tx) => {
    const cust = await tx.customer.update({
      where: { id: customerId },
      data: {
        status: 'active',
        notes: updatedNote,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'REOPEN_CUSTOMER_ACCOUNT',
      entityType: 'Customer',
      entityId: customerId,
      oldValues: { status: 'closed' },
      newValues: { status: 'active', reason: reopenReason },
      reason: `إعادة فتح حساب العميل ${cust.name} (${cust.customerCode}) بواسطة مدير النظام ${user.name}: ${reopenReason}`,
    });

    return cust;
  });

  return NextResponse.json({
    success: true,
    message: `تم إعادة فتح حساب العميل ${updatedCustomer.name} بنجاح، ويمكنه الآن استئناف العمليات`,
    data: {
      id: updatedCustomer.id,
      name: updatedCustomer.name,
      status: updatedCustomer.status,
      reopenedAt: new Date().toISOString(),
      reopenedBy: user.name,
    },
  });
}
