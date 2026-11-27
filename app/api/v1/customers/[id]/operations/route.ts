import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { calculateExchange } from '@/lib/financial-core';
import { assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { uploadReceiptImage, deleteReceiptImages } from '@/lib/storage/supabase-storage';
import { logAuditEvent } from '@/lib/audit';
import { approveBankakReceiptAtomic } from '@/lib/receipts/receipt-approval-service';
import { processReceiptImageWithOcr } from '@/lib/ocr/image-ocr';
import { evaluateReceiptRisk, ParsedBankakReceipt } from '@/lib/ocr/bankak-parser';
import { verifyOcrPreviewToken } from '@/lib/ocr/preview-token';
import Decimal from 'decimal.js';

interface ReceiptInput {
  amount?: number | string;
  senderName?: string;
  senderAccount?: string;
  receiverName?: string;
  receiverAccount?: string;
  transactionId?: string;
  transactionDate?: string;
  transactionTime?: string;
  imageData?: string; // base64 or data URL
  previewToken?: string;
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
      useOcr = false,
      idempotencyKey,
    } = body;

    if (!exchangeRate) {
      return NextResponse.json(
        { error: 'سعر الصرف مطلوب', success: false },
        { status: 400 }
      );
    }

    const dRate = new Decimal(exchangeRate.toString());
    if (dRate.isNegative() || dRate.isZero() || isNaN(dRate.toNumber())) {
      return NextResponse.json({ error: 'سعر الصرف يجب أن يكون رقماً موجباً أكبر من الصفر', success: false }, { status: 400 });
    }

    const isOcrMode = Boolean(useOcr);
    if (isOcrMode && (!Array.isArray(receipts) || receipts.length === 0)) {
      return NextResponse.json(
        { error: 'يرجى إرفاق صورة إيصال واحدة على الأقل', success: false },
        { status: 400 }
      );
    }

    if (!isOcrMode && !totalSdg) {
      return NextResponse.json(
        { error: 'إجمالي المبلغ بالجنيه السوداني وسعر الصرف مطلوبان', success: false },
        { status: 400 }
      );
    }

    // Idempotency guard: scoped by userId + customerId + idempotencyKey
    const cleanIdempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey.trim()
      ? idempotencyKey.trim()
      : null;
    const scopedIdempotencyMarker = cleanIdempotencyKey
      ? `[idempotency:${user.userId}:${customerId}:${cleanIdempotencyKey}]`
      : null;

    if (scopedIdempotencyMarker) {
      const existingAudit = await prisma.auditLog.findFirst({
        where: {
          action: 'CREATE_CUSTOMER_OPERATION',
          entityType: 'CustomerSession',
          reason: { contains: scopedIdempotencyMarker },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingAudit?.entityId) {
        const existingSession = await prisma.customerSession.findUnique({
          where: { id: existingAudit.entityId },
          include: { receipts: true },
        });
        if (existingSession) {
          return NextResponse.json({
            success: true,
            idempotentReplay: true,
            message: `تم تنفيذ هذه العملية مسبقاً (${existingSession.sessionNumber}) دون تكرار`,
            data: {
              session: existingSession,
              receipts: existingSession.receipts,
              autoApprovedCount: existingSession.receipts.filter((r) => r.status === 'approved').length,
              autoApproveErrors: [],
              calculated: {
                totalSdg: Number(existingSession.expectedAmount),
                exchangeRate: Number(existingSession.exchangeRate),
                equivalentEgp: Number(existingSession.requestedAmount),
              },
            },
          });
        }
      }
    }

    const bDate = businessDate || operationDate || new Date().toISOString().split('T')[0];
    await assertBusinessDateOpen(bDate);

    // 1. Prepare receipts: either via real OCR extraction (no synthetic TRX/amounts) or legacy manual split
    const uploadedReceiptsData: {
      storageKey: string;
      amount: Decimal;
      transactionId: string;
      senderName?: string;
      senderAccount?: string;
      receiverName?: string;
      receiverAccount?: string;
      transactionDate?: string;
      transactionTime?: string;
      ocrText?: string;
      ocrConfidence?: number;
      imageHash: string;
      status: string;
      isDuplicate: boolean;
      isSuspicious: boolean;
      duplicateOfId: string | null;
      suspicionReason: string | null;
      notes?: string;
    }[] = [];

    let dTotalSdg = new Decimal(0);

    if (isOcrMode) {
      const existingReceipts = await prisma.bankakReceipt.findMany({
        where: { status: { not: 'rejected' } },
        select: {
          id: true,
          receiptNumber: true,
          transactionId: true,
          imageHash: true,
          amount: true,
          transactionDate: true,
          senderName: true,
          status: true,
        },
      });
      const inBatchExisting: Array<{
        id: string;
        transactionId: string;
        imageHash: string;
        amount: any;
        transactionDate?: string | null;
        senderName?: string | null;
        status: string;
      }> = [...existingReceipts];

      for (let i = 0; i < receipts.length; i++) {
        const r = receipts[i];
        if (!r.imageData || typeof r.imageData !== 'string') {
          continue;
        }

        let parsed: ParsedBankakReceipt;
        let rawText = '';
        let imageHash = '';

        if (r.previewToken) {
          try {
            const verified = verifyOcrPreviewToken(r.previewToken, {
              imageData: r.imageData,
              userId: user.userId,
              customerId,
            });
            parsed = verified.parsed;
            rawText = verified.rawText;
            imageHash = verified.imageHash;
          } catch (tokenErr: any) {
            if (uploadedStorageKeys.length > 0) {
              await deleteReceiptImages(uploadedStorageKeys).catch(() => {});
            }
            return NextResponse.json(
              { error: tokenErr?.message || 'رمز معاينة الـ OCR غير صالح', success: false },
              { status: 400 }
            );
          }

          const uploadRes = await uploadReceiptImage(
            r.imageData,
            `cust-${customerId}-${Date.now()}-${i + 1}.png`
          );
          var storageKey = uploadRes.signedUrl || uploadRes.storageKey || 'no-image';
          if (uploadRes.storageKey && uploadRes.storageKey !== 'no-image') {
            uploadedStorageKeys.push(uploadRes.storageKey);
          }
        } else {
          // No preview token: run full server-side OCR directly on imageData (never accept browser rawOcrText)
          const [ocrResult, uploadRes] = await Promise.all([
            processReceiptImageWithOcr(r.imageData),
            uploadReceiptImage(r.imageData, `cust-${customerId}-${Date.now()}-${i + 1}.png`),
          ]);
          parsed = ocrResult.parsed;
          rawText = ocrResult.rawText;
          imageHash = ocrResult.imageHash;

          var storageKey = uploadRes.signedUrl || uploadRes.storageKey || 'no-image';
          if (uploadRes.storageKey && uploadRes.storageKey !== 'no-image') {
            uploadedStorageKeys.push(uploadRes.storageKey);
          }
        }
        const transactionId = (parsed.transactionId || '').trim();
        const amountNum = Number(parsed.amount || 0);
        const amountD = new Decimal(amountNum.toString());
        const receiverName = (parsed.receiverName || '').trim();

        const riskAssessment = evaluateReceiptRisk(
          {
            transactionId,
            imageHash,
            amount: amountNum,
            transactionDate: parsed.transactionDate,
            senderName: (parsed.senderName || '').trim(),
          },
          inBatchExisting
        );

        let status: string = riskAssessment.status;
        if (
          status === 'pending_verification' &&
          (parsed.ocrConfidence < 70 ||
            amountNum <= 0 ||
            !transactionId ||
            !receiverName ||
            !parsed.dateValid ||
            parsed.amountNeedsReview ||
            parsed.extractedFieldsCount < 2)
        ) {
          status = 'pending_review';
        }

        const isDuplicate = riskAssessment.isDuplicate;
        const isSuspicious = riskAssessment.isSuspicious;
        const eligible = !isDuplicate && !isSuspicious && amountNum > 0;

        if (eligible) {
          dTotalSdg = dTotalSdg.plus(amountD);
        }

        inBatchExisting.push({
          id: `batch-${i + 1}`,
          transactionId,
          imageHash,
          amount: amountNum,
          transactionDate: parsed.transactionDate || null,
          senderName: parsed.senderName || null,
          status,
        });

        uploadedReceiptsData.push({
          storageKey,
          amount: amountD,
          transactionId,
          senderName: (parsed.senderName || '').trim(),
          senderAccount: (parsed.senderAccount || '').trim(),
          receiverName,
          receiverAccount: (parsed.receiverAccount || '').trim(),
          transactionDate: parsed.transactionDate || bDate,
          transactionTime: parsed.transactionTime || '12:00:00',
          ocrText: rawText,
          ocrConfidence: parsed.ocrConfidence,
          imageHash,
          status,
          isDuplicate,
          isSuspicious,
          duplicateOfId: riskAssessment.matchedReceiptId || null,
          suspicionReason: riskAssessment.reason || null,
          notes: r.notes || notes,
        });
      }

      if (dTotalSdg.isNegative() || dTotalSdg.isZero()) {
        if (uploadedStorageKeys.length > 0) {
          await deleteReceiptImages(uploadedStorageKeys).catch(() => {});
        }
        return NextResponse.json(
          {
            error: 'لا توجد إيصالات صالحة ومؤهلة للاعتماد (جميع الإيصالات مكررة أو مشبوهة أو بمبلغ غير مقروء)',
            success: false,
          },
          { status: 400 }
        );
      }
    } else {
      dTotalSdg = new Decimal(totalSdg.toString());
      if (dTotalSdg.isNegative() || dTotalSdg.isZero() || isNaN(dTotalSdg.toNumber())) {
        return NextResponse.json({ error: 'إجمالي المبلغ السوداني يجب أن يكون رقماً موجباً أكبر من الصفر', success: false }, { status: 400 });
      }

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
          imageHash: `hash-manual-${Date.now()}-${i + 1}`,
          status: 'pending_review',
          isDuplicate: false,
          isSuspicious: false,
          duplicateOfId: null,
          suspicionReason: null,
          notes: r.notes || notes,
        });
      }

      const remainingToCreate = Math.max(0, numReceiptsExpected - receipts.length);
      for (let j = 0; j < remainingToCreate; j++) {
        uploadedReceiptsData.push({
          storageKey: 'no-image',
          amount: splitAmountD,
          transactionId: `TRX-${Date.now()}-P${j + 1}-${Math.floor(100 + Math.random() * 900)}`,
          senderName: customer.name,
          transactionDate: bDate,
          imageHash: `hash-placeholder-${Date.now()}-${j + 1}`,
          status: 'pending_review',
          isDuplicate: false,
          isSuspicious: false,
          duplicateOfId: null,
          suspicionReason: null,
          notes: notes || 'إيصال ضمن عملية مجمعة بانتظار إرفاق الصورة',
        });
      }
    }

    // Formula: Equivalent EGP = Total SDG / Exchange Rate
    const calc = calculateExchange(dTotalSdg.toNumber(), dRate.toNumber(), 'SDG_TO_EGP');
    const equivalentEgpD = new Decimal(calc.toAmount);

    // 2. Perform Single Atomic Database Transaction (FOR UPDATE row lock + advisory lock + fail-closed idempotency)
    const result = await prisma.$transaction(async (tx) => {
      let lockAcquired = false;
      try {
        await tx.$queryRawUnsafe('SELECT id FROM "Customer" WHERE id = $1 FOR UPDATE', customerId);
        lockAcquired = true;
      } catch {
        // Fallback to advisory lock below
      }

      if (scopedIdempotencyMarker) {
        try {
          await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            `op:${user.userId}:${customerId}:${cleanIdempotencyKey}`
          );
          lockAcquired = true;
        } catch {
          if (!lockAcquired) {
            throw new Error('تعذر تأمين قفل التزامن في قاعدة البيانات لحماية العملية من التكرار');
          }
        }

        const existingAuditInTx = await tx.auditLog.findFirst({
          where: {
            action: 'CREATE_CUSTOMER_OPERATION',
            entityType: 'CustomerSession',
            reason: { contains: scopedIdempotencyMarker },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existingAuditInTx?.entityId) {
          const existingSessionInTx = await tx.customerSession.findUnique({
            where: { id: existingAuditInTx.entityId },
            include: { receipts: true },
          });
          if (existingSessionInTx) {
            return {
              idempotentReplay: true as const,
              session: existingSessionInTx,
              receipts: existingSessionInTx.receipts,
            };
          }
        }
      }
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

      // Create Linked BankakReceipt records (preserving OCR status & DB duplicate guards)
      const createdReceipts = [];
      for (let k = 0; k < uploadedReceiptsData.length; k++) {
        const item = uploadedReceiptsData[k];
        const rNumber = `RCP-${Date.now()}-${k + 1}-${Math.floor(100 + Math.random() * 900)}`;

        let itemStatus = item.status;
        let itemIsDuplicate = item.isDuplicate;
        let itemDuplicateOfId = item.duplicateOfId;
        let itemSuspicionReason = item.suspicionReason;

        if (item.transactionId) {
          try {
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', item.transactionId);
          } catch {
            // Safe fallback
          }
          const concurrentMatch = await tx.bankakReceipt.findFirst({
            where: {
              transactionId: item.transactionId,
              status: { notIn: ['duplicate', 'rejected'] },
            },
            select: { id: true, receiptNumber: true },
          });
          if (concurrentMatch) {
            itemStatus = 'duplicate';
            itemIsDuplicate = true;
            itemDuplicateOfId = concurrentMatch.id;
            itemSuspicionReason = `تطابق قطعي بالتزامن: رقم العملية (${item.transactionId}) مسجل مسبقاً بالإيصال ${concurrentMatch.receiptNumber}`;
          }
        }

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
            transactionTime: item.transactionTime,
            ocrText: item.ocrText,
            ocrConfidence: item.ocrConfidence ?? 0,
            bankName: 'بنكك - بنك الخرطوم',
            imageStorageKey: item.storageKey,
            imageHash: item.imageHash,
            status: itemStatus,
            duplicateOfId: itemDuplicateOfId,
            isSuspicious: item.isSuspicious,
            suspicionReason: itemSuspicionReason,
            createdBy: user.name,
          },
        });
        createdReceipts.push(receiptRecord);
      }

      // Record Idempotency + Creation Audit Log atomically INSIDE the same transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'CREATE_CUSTOMER_OPERATION',
        entityType: 'CustomerSession',
        entityId: session.id,
        newValues: {
          sessionNumber: session.sessionNumber,
          customerId,
          totalSdg: dTotalSdg.toFixed(2),
          exchangeRate: dRate.toFixed(4),
          equivalentEgp: equivalentEgpD.toFixed(2),
          receiptsCount: createdReceipts.length,
        },
        reason: `إنشاء عملية حسابية للعميل ${customer.name} بإجمالي ${dTotalSdg.toLocaleString()} SDG ومقابل ${equivalentEgpD.toLocaleString()} EGP${scopedIdempotencyMarker ? ` ${scopedIdempotencyMarker}` : ''}`,
        tx,
      });

      return { idempotentReplay: false as const, session, receipts: createdReceipts };
    });

    if (result.idempotentReplay) {
      if (uploadedStorageKeys.length > 0) {
        await deleteReceiptImages(uploadedStorageKeys).catch(() => {});
      }
      return NextResponse.json({
        success: true,
        idempotentReplay: true,
        message: `تم تنفيذ هذه العملية مسبقاً (${result.session.sessionNumber}) دون تكرار`,
        data: {
          session: result.session,
          receipts: result.receipts,
          autoApprovedCount: result.receipts.filter((r: any) => r.status === 'approved').length,
          autoApproveErrors: [],
          calculated: {
            totalSdg: Number(result.session.expectedAmount),
            exchangeRate: Number(result.session.exchangeRate),
            equivalentEgp: Number(result.session.requestedAmount),
          },
        },
      });
    }

    // 3. Auto-Verify & Auto-Approve every created receipt with amount > 0
    const finalReceipts = [];
    let autoApprovedCount = 0;
    const autoApproveErrors: Array<{ receiptId: string; receiptNumber: string; error: string }> = [];

    for (const rcp of result.receipts) {
      if (
        !rcp.isSuspicious &&
        rcp.status !== 'duplicate' &&
        rcp.status !== 'rejected' &&
        Number(rcp.amount) > 0
      ) {
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
