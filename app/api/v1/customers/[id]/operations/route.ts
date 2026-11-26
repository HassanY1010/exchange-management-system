import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { calculateExchange } from '@/lib/financial-core';
import { assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { uploadReceiptImage, deleteReceiptImages } from '@/lib/storage/supabase-storage';
import { logAuditEvent } from '@/lib/audit';
import { approveBankakReceiptAtomic } from '@/lib/receipts/receipt-approval-service';
import Decimal from 'decimal.js';

interface ReceiptInput {
  amount?: number | string;
  senderName?: string;
  senderAccount?: string;
  receiverName?: string;
  receiverAccount?: string;
  transactionId?: string;
  transactionDate?: string;
  imageData?: string; // base64 or data URL
  notes?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // RBAC: Admin, Accountant, and Data Entry can create customer operations & upload receipts
  const allowedRoles = ['admin', 'accountant', 'data_entry'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بإنشاء عمليات للعملاء أو رفع إيصالاتهم', success: false },
      { status: 403 }
    );
  }

  const customerId = params.id;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    return NextResponse.json({ error: 'العميل غير موجود', success: false }, { status: 404 });
  }

  if (customer.status === 'blocked') {
    return NextResponse.json({ error: 'لا يمكن إنشاء عملية لعميل محظور في النظام', success: false }, { status: 400 });
  }

  if (customer.status === 'closed') {
    return NextResponse.json(
      { error: 'حساب العميل مقفل حالياً. لا يمكن إنشاء عمليات أو إرفاق إيصالات جديدة لعميل مقفل.', success: false },
      { status: 400 }
    );
  }

  const uploadedStorageKeys: string[] = [];

  try {
    const body = await req.json();
    const {
      totalSdg,
      exchangeRate,
      receiptCount,
      receipts = [] as ReceiptInput[],
      operationDate,
      businessDate,
      notes,
    } = body;

    if (!totalSdg || !exchangeRate) {
      return NextResponse.json(
        { error: 'إجمالي المبلغ بالجنيه السوداني وسعر الصرف مطلوبان', success: false },
        { status: 400 }
      );
    }

    const dTotalSdg = new Decimal(totalSdg.toString());
    const dRate = new Decimal(exchangeRate.toString());

    if (dTotalSdg.isNegative() || dTotalSdg.isZero() || isNaN(dTotalSdg.toNumber())) {
      return NextResponse.json({ error: 'إجمالي المبلغ السوداني يجب أن يكون رقماً موجباً أكبر من الصفر', success: false }, { status: 400 });
    }

    if (dRate.isNegative() || dRate.isZero() || isNaN(dRate.toNumber())) {
      return NextResponse.json({ error: 'سعر الصرف يجب أن يكون رقماً موجباً أكبر من الصفر', success: false }, { status: 400 });
    }

    // Formula: Equivalent EGP = Total SDG / Exchange Rate
    const calc = calculateExchange(dTotalSdg.toNumber(), dRate.toNumber(), 'SDG_TO_EGP');
    const equivalentEgpD = new Decimal(calc.toAmount);

    const bDate = businessDate || operationDate || new Date().toISOString().split('T')[0];
    await assertBusinessDateOpen(bDate);

    // 1. Upload receipt images (if provided) before DB transaction to keep DB transaction fast and atomic
    const uploadedReceiptsData: {
      storageKey: string;
      amount: Decimal;
      transactionId: string;
      senderName?: string;
      senderAccount?: string;
      receiverName?: string;
      receiverAccount?: string;
      transactionDate?: string;
      notes?: string;
    }[] = [];

    const numReceiptsExpected = Math.max(Number(receiptCount || 0), receipts.length, 1);
    const splitAmountD = dTotalSdg.dividedBy(numReceiptsExpected);

    for (let i = 0; i < receipts.length; i++) {
      const r = receipts[i];
      let storageKey = 'no-image';

      if (r.imageData && typeof r.imageData === 'string') {
        const uploadRes = await uploadReceiptImage(r.imageData, `cust-${customerId}-${Date.now()}-${i + 1}.png`);
        storageKey = uploadRes.storageKey;
        if (storageKey && storageKey !== 'no-image') {
          uploadedStorageKeys.push(storageKey);
        }
      }

      const receiptAmountD = r.amount ? new Decimal(r.amount.toString()) : splitAmountD;
      const txId = r.transactionId?.trim() || `TRX-${Date.now()}-${i + 1}-${Math.floor(100 + Math.random() * 900)}`;

      uploadedReceiptsData.push({
        storageKey,
        amount: receiptAmountD,
        transactionId: txId,
        senderName: r.senderName || customer.name,
        senderAccount: r.senderAccount,
        receiverName: r.receiverName,
        receiverAccount: r.receiverAccount,
        transactionDate: r.transactionDate || bDate,
        notes: r.notes || notes,
      });
    }

    // If receiptCount was given but fewer actual images were sent, create placeholder items for remaining count
    const remainingToCreate = Math.max(0, numReceiptsExpected - receipts.length);
    for (let j = 0; j < remainingToCreate; j++) {
      uploadedReceiptsData.push({
        storageKey: 'no-image',
        amount: splitAmountD,
        transactionId: `TRX-${Date.now()}-P${j + 1}-${Math.floor(100 + Math.random() * 900)}`,
        senderName: customer.name,
        transactionDate: bDate,
        notes: notes || 'إيصال ضمن عملية مجمعة بانتظار إرفاق الصورة',
      });
    }

    // 2. Perform Single Atomic Database Transaction
    const result = await prisma.$transaction(async (tx) => {
      const cleanDate = bDate.replace(/-/g, '');
      const prefix = `SES-${cleanDate}-`;

      // Generate sequential sessionNumber
      const latestSession = await tx.customerSession.findFirst({
        where: { sessionNumber: { startsWith: prefix } },
        orderBy: { sessionNumber: 'desc' },
        select: { sessionNumber: true },
      });

      let nextSeq = 1001;
      if (latestSession && latestSession.sessionNumber) {
        const parts = latestSession.sessionNumber.split('-');
        if (parts.length >= 3) {
          const parsedSeq = parseInt(parts[2], 10);
          if (!isNaN(parsedSeq) && parsedSeq >= 1000) {
            nextSeq = parsedSeq + 1;
          }
        }
      }

      const candidateSessionNumber = `${prefix}${nextSeq}`;

      // Create CustomerSession
      const session = await tx.customerSession.create({
        data: {
          sessionNumber: candidateSessionNumber,
          customerId,
          businessDate: bDate,
          exchangeRate: dRate.toFixed(4),
          currencyFrom: 'SDG',
          currencyTo: 'EGP',
          requestedAmount: equivalentEgpD.toFixed(4), // EGP (e.g. 100,000)
          expectedAmount: dTotalSdg.toFixed(4),       // SDG (e.g. 20,000,000)
          receivedAmount: 0,                          // 0 until receipts are verified & approved
          deliveredAmount: 0,                         // 0 until paid out
          remainingAmount: dTotalSdg.toFixed(4),
          overpaymentAmount: 0,
          status: 'open',
          createdBy: user.name,
        },
      });

      // Create Linked BankakReceipt records
      const createdReceipts = [];
      for (let k = 0; k < uploadedReceiptsData.length; k++) {
        const item = uploadedReceiptsData[k];
        const rNumber = `RCP-${Date.now()}-${k + 1}-${Math.floor(100 + Math.random() * 900)}`;

        const receiptRecord = await tx.bankakReceipt.create({
          data: {
            receiptNumber: rNumber,
            transactionId: item.transactionId,
            customerId,
            customerSessionId: session.id,
            amount: item.amount.toFixed(4),
            currency: 'SDG',
            senderName: item.senderName,
            senderAccount: item.senderAccount,
            receiverName: item.receiverName,
            receiverAccount: item.receiverAccount,
            transactionDate: item.transactionDate,
            bankName: 'بنكك - بنك الخرطوم',
            imageStorageKey: item.storageKey,
            imageHash: `hash-${rNumber}`,
            status: 'pending_review',
            createdBy: user.name,
          },
        });
        createdReceipts.push(receiptRecord);
      }

      return { session, receipts: createdReceipts };
    });

    // 3. Auto-Verify & Auto-Approve every created receipt with amount > 0
    const finalReceipts = [];
    let autoApprovedCount = 0;
    const autoApproveErrors: Array<{ receiptId: string; receiptNumber: string; error: string }> = [];

    for (const rcp of result.receipts) {
      if (Number(rcp.amount) > 0) {
        try {
          const approvedRes = await approveBankakReceiptAtomic({
            receiptId: rcp.id,
            userId: user.userId,
            userName: user.name,
            userRole: user.role,
            directVerification: true,
            allowAutoApproval: true,
            verificationSource: 'auto_customer_operation_approval',
            verificationNotes: 'تم التحقق البنكي والاعتماد المالي تلقائياً عند إنشاء عملية العميل',
          });
          finalReceipts.push(approvedRes.receipt);
          autoApprovedCount++;
        } catch (autoErr: any) {
          const errMsg = autoErr?.message || 'تعذر الاعتماد التلقائي';
          console.warn(`[Auto-Approve Warning] Customer operation receipt ${rcp.receiptNumber}: ${errMsg}`);
          autoApproveErrors.push({
            receiptId: rcp.id,
            receiptNumber: rcp.receiptNumber,
            error: errMsg,
          });
          finalReceipts.push(rcp);
        }
      } else {
        finalReceipts.push(rcp);
      }
    }

    const updatedSession =
      (await prisma.customerSession.findUnique({
        where: { id: result.session.id },
      })) || result.session;

    // 4. Log Audit Event
    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_CUSTOMER_OPERATION',
      entityType: 'CustomerSession',
      entityId: updatedSession.id,
      newValues: {
        sessionNumber: updatedSession.sessionNumber,
        customerId,
        totalSdg: dTotalSdg.toFixed(2),
        exchangeRate: dRate.toFixed(4),
        equivalentEgp: equivalentEgpD.toFixed(2),
        receiptsCount: finalReceipts.length,
        autoApprovedCount,
      },
      reason: `إنشاء عملية حسابية للعميل ${customer.name} بإجمالي ${dTotalSdg.toLocaleString()} SDG ومقابل ${equivalentEgpD.toLocaleString()} EGP (تم اعتماد ${autoApprovedCount}/${finalReceipts.length} إيصال تلقائياً)`,
    });

    return NextResponse.json({
      success: true,
      message: `تم إنشاء العملية ${updatedSession.sessionNumber} وربط ${finalReceipts.length} إيصالات (تم التحقق والاعتماد التلقائي لـ ${autoApprovedCount} إيصال)`,
      data: {
        session: updatedSession,
        receipts: finalReceipts,
        autoApprovedCount,
        autoApproveErrors,
        calculated: {
          totalSdg: dTotalSdg.toNumber(),
          exchangeRate: dRate.toNumber(),
          equivalentEgp: equivalentEgpD.toNumber(),
        },
      },
    });
  } catch (error: any) {
    console.error('Error creating customer operation:', error);

    // Atomic Rollback: Clean up any uploaded storage files so no orphaned files remain in storage
    if (uploadedStorageKeys.length > 0) {
      try {
        console.warn(`Cleaning up ${uploadedStorageKeys.length} uploaded storage files due to transaction rollback...`);
        await deleteReceiptImages(uploadedStorageKeys);
        console.log('Successfully cleaned up orphaned storage files.');
      } catch (cleanupErr) {
        console.error('Failed to cleanup storage keys during rollback:', cleanupErr);
      }
    }

    return NextResponse.json(
      { error: error.message || 'حدث خطأ أثناء حفظ العملية والإيصالات', success: false },
      { status: 500 }
    );
  }
}
