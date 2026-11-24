import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { getCustomerFinancialStatus } from '@/lib/customers/customer-balance-service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can close a customer account
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية إقفال حساب العميل مقتصرة على المحاسب المالي أو مدير النظام', success: false },
      { status: 403 }
    );
  }

  const customerId = params.id;
  const body = await req.json().catch(() => ({}));
  const { reason } = body;

  const financialStatus = await getCustomerFinancialStatus(customerId);
  if (!financialStatus) {
    return NextResponse.json({ error: 'العميل غير موجود في النظام', success: false }, { status: 404 });
  }

  if (financialStatus.status === 'closed') {
    return NextResponse.json(
      { error: 'حساب العميل مقفل بالفعل في النظام', success: false },
      { status: 400 }
    );
  }

  // Pre-closing validation: Strict Zero-Balance & No Pending Operations Policy
  // Prohibit closing any account with outstanding debtor/creditor balances or open operations
  if (!financialStatus.canClose) {
    return NextResponse.json(
      {
        success: false,
        canClose: false,
        error: 'لا يمكن إقفال الحساب نظراً لوجود التزامات مالية أو عمليات معلقة غير مكتملة. يجب تصفية كافة الأرصدة وإغلاق العمليات أولاً قبل إقفال الحساب.',
        blockingReasons: financialStatus.blockingReasons,
        balances: financialStatus.balances,
        pendingOperations: financialStatus.pendingOperations,
      },
      { status: 400 }
    );
  }

  const closeReason = reason?.trim() || 'إقفال حساب بعد تصفية كافة الأرصدة والعمليات المعلقة';

  // Update Customer Status to closed atomically
  const updatedCustomer = await prisma.$transaction(async (tx) => {
    const cust = await tx.customer.update({
      where: { id: customerId },
      data: {
        status: 'closed',
        notes: custNotesAppend(financialStatus.status, closeReason, user.name),
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CLOSE_CUSTOMER_ACCOUNT',
      entityType: 'Customer',
      entityId: customerId,
      oldValues: {
        status: financialStatus.status,
      },
      newValues: {
        status: 'closed',
        reason: closeReason,
        balancesAtClose: financialStatus.balances,
        pendingOperationsCount: financialStatus.pendingOperations.count,
      },
      reason: `إقفال حساب العميل ${cust.name} (${cust.customerCode}) بواسطة ${user.name}: ${closeReason}`,
    });

    return cust;
  });

  return NextResponse.json({
    success: true,
    message: `تم إقفال حساب العميل ${updatedCustomer.name} بنجاح وحظر إنشاء أي عمليات مالية جديدة عليه`,
    data: {
      id: updatedCustomer.id,
      name: updatedCustomer.name,
      status: updatedCustomer.status,
      closedAt: new Date().toISOString(),
      closedBy: user.name,
      balances: financialStatus.balances,
    },
  });
}

function custNotesAppend(oldStatus: string, reason: string, userName: string) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return `[${timestamp}] تم تغيير الحالة من (${oldStatus}) إلى (closed) بواسطة (${userName}). السبب: ${reason}`;
}
