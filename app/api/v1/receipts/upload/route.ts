import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { parseBankakReceiptText, computeImageHash, evaluateReceiptRisk } from '@/lib/ocr/bankak-parser';
import { processReceiptImageWithOcr } from '@/lib/ocr/image-ocr';
import { uploadReceiptImage } from '@/lib/storage/supabase-storage';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';
import { getSystemSetting } from '@/lib/settings/settings-service';
import { approveBankakReceiptAtomic } from '@/lib/receipts/receipt-approval-service';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const allowedRoles = ['admin', 'accountant', 'data_entry', 'bankak_auditor'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك برفع إيصالات بنكك. الصلاحية مقتصرة على موظفي الإدخال، المحاسبين، أو الإدارة' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    // Support either single object or array of receipts
    const items = Array.isArray(body.items) ? body.items : [body];

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'لم يتم توفير أي إيصالات للرفع' }, { status: 400 });
    }

    if (items.length > 50) {
      return NextResponse.json({ error: 'الحد الأقصى لرفع الإيصالات في الدفعة الواحدة هو 50 إيصال' }, { status: 400 });
    }

    const results = [];
    const failedItems: Array<{ index: number; error: string }> = [];

    // Pre-fetch all non-rejected receipts for multi-attribute risk and duplicate evaluation
    const existingReceipts: Array<{
      id: string;
      receiptNumber?: string;
      transactionId: string;
      imageHash: string;
      amount: any;
      transactionDate?: string | null;
      senderName?: string | null;
      status: string;
      customer?: { name: string } | null;
    }> = await prisma.bankakReceipt.findMany({
      where: {
        status: { not: 'rejected' },
      },
      select: {
        id: true,
        receiptNumber: true,
        transactionId: true,
        imageHash: true,
        amount: true,
        transactionDate: true,
        senderName: true,
        status: true,
        customer: { select: { name: true } },
      },
    });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const {
        customerId,
        customerSessionId,
        imageData, // base64 string or image url
        rawOcrText, // optional pre-extracted text
      } = item;

      // File & Payload Validation: check base64 format and size
      if (imageData && typeof imageData === 'string') {
        if (imageData.startsWith('data:')) {
          const match = imageData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-\+\.]+);base64,/);
          if (match) {
            const mime = match[1].toLowerCase();
            const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
            if (!allowedMimes.includes(mime)) {
              return NextResponse.json(
                { error: `نوع الملف (${mime}) غير مدعوم حالياً. يرجى رفع إشعارات بنكك كصور بصيغة PNG أو JPG أو JPEG أو WebP أو تصويرها مباشرة بكاميرا الجوال` },
                { status: 400 }
              );
            }
          }
        }
        // Limit base64 length to ~15MB to prevent memory exhaustion / DoS
        if (imageData.length > 20 * 1024 * 1024) {
          return NextResponse.json(
            { error: 'حجم صورة الإيصال يتجاوز الحد الأقصى المسموح به (15 ميغابايت)' },
            { status: 400 }
          );
        }
      }

      // If linked to a session, verify session is not cancelled
      if (customerSessionId) {
        const session = await prisma.customerSession.findUnique({
          where: { id: customerSessionId },
          select: { status: true },
        });
        if (session && session.status === 'cancelled') {
          return NextResponse.json(
            { error: 'لا يمكن ربط إيصال بجلسة حسابية ملغاة' },
            { status: 400 }
          );
        }
      }

      // If linked to a customer, verify customer is not closed or blocked
      if (customerId) {
        const cust = await prisma.customer.findUnique({
          where: { id: customerId },
          select: { status: true, name: true },
        });
        if (cust?.status === 'closed') {
          return NextResponse.json(
            { error: `حساب العميل (${cust.name}) مقفل حالياً. لا يمكن رفع إيصالات جديدة لحساب مقفل.`, success: false },
            { status: 400 }
          );
        }
        if (cust?.status === 'blocked') {
          return NextResponse.json(
            { error: `حساب العميل (${cust.name}) محظور في النظام.`, success: false },
            { status: 400 }
          );
        }
      }

      const itemStartTime = Date.now();

      // Parallelize OCR text extraction and Storage upload concurrently
      const ocrTask = processReceiptImageWithOcr(
        imageData || `synthetic-${Date.now()}-${i}`,
        rawOcrText || item.ocrText
      );

      const storageTask = imageData
        ? uploadReceiptImage(imageData, `rcp-${Date.now()}-${i}.png`)
        : Promise.resolve({ storageKey: 'no-image', signedUrl: undefined, source: 'local_storage' as const });

      const [ocrResult, uploadResult] = await Promise.all([ocrTask, storageTask]);
      const imageHash = ocrResult.imageHash;
      const parsed = ocrResult.parsed;
      const imageStorageKey = uploadResult.signedUrl || uploadResult.storageKey || 'no-image';

      // Override with user fields if explicitly provided
      const transactionId = (item.transactionId || parsed.transactionId || '').trim();
      const amount = item.amount !== undefined ? Number(item.amount) : parsed.amount;
      const senderName = (item.senderName || parsed.senderName || '').trim();
      const senderAccount = (item.senderAccount || parsed.senderAccount || '').trim();
      const receiverName = (item.receiverName || parsed.receiverName || '').trim();
      const receiverAccount = (item.receiverAccount || parsed.receiverAccount || '').trim();
      const transactionDate = item.transactionDate || parsed.transactionDate;
      const transactionTime = item.transactionTime || parsed.transactionTime;

      // Multi-attribute Anti-Fraud & Risk Assessment (Tier 1 Duplicate, Tier 2 Suspicious)
      const riskAssessment = evaluateReceiptRisk(
        {
          transactionId,
          imageHash,
          amount,
          transactionDate,
          senderName,
        },
        existingReceipts
      );

      let status: string = riskAssessment.status;
      // Low OCR confidence, unextracted/zero amount, missing recipient, or invalid date mandates manual review status
      if (
        status === 'pending_verification' &&
        (parsed.ocrConfidence < 70 || amount <= 0 || !transactionId || !receiverName || !parsed.dateValid || parsed.amountNeedsReview || parsed.extractedFieldsCount < 2)
      ) {
        status = 'pending_review';
      }

      let isDuplicate = riskAssessment.isDuplicate;
      let isSuspicious = riskAssessment.isSuspicious;
      let duplicateOfId = riskAssessment.matchedReceiptId || null;
      let suspicionReason = riskAssessment.reason || null;

      const receiptNumber = `RCP-${Date.now()}-${i + 1}`;

      // Concurrency-safe DB insert with advisory lock & unique constraint protection
      const receipt = await prisma.$transaction(async (tx) => {
        if (transactionId) {
          // Acquire transaction-scoped advisory lock on transactionId (fail-safe for pooled connections)
          try {
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', transactionId);
          } catch {
            // Advisory locks may not be supported in some connection pooler modes; fall back safely to DB constraints
          }

          // Check if concurrent request already inserted this transactionId as active
          const concurrentMatch = await tx.bankakReceipt.findFirst({
            where: {
              transactionId,
              status: { notIn: ['duplicate', 'rejected'] },
            },
            select: { id: true, receiptNumber: true },
          });

          if (concurrentMatch) {
            status = 'duplicate';
            isDuplicate = true;
            duplicateOfId = concurrentMatch.id;
            suspicionReason = `تطابق قطعي بالتزامن: رقم العملية (${transactionId}) مسجل مسبقاً بالإيصال ${concurrentMatch.receiptNumber}`;
          }
        }

        try {
          return await tx.bankakReceipt.create({
            data: {
              receiptNumber,
              transactionId,
              customerId: customerId || null,
              customerSessionId: customerSessionId || null,
              senderName,
              senderAccount,
              receiverName,
              receiverAccount,
              amount,
              currency: 'SDG',
              transactionDate,
              transactionTime,
              bankName: 'بنكك - بنك الخرطوم',
              ocrText: rawOcrText || parsed.rawText,
              ocrConfidence: parsed.ocrConfidence,
              imageStorageKey,
              imageHash,
              status,
              duplicateOfId,
              isSuspicious,
              suspicionReason,
              createdBy: user.name,
            },
            include: {
              customer: true,
              customerSession: true,
            },
          });
        } catch (dbErr: any) {
          // Graceful handling of Unique Constraint error (P2002 or Postgres 23505) without crash
          if (
            dbErr.code === 'P2002' ||
            dbErr.message?.includes('idx_bankak_receipt_active_txn') ||
            dbErr.message?.includes('unique constraint')
          ) {
            const conflict = await tx.bankakReceipt.findFirst({
              where: { transactionId, status: { notIn: ['duplicate', 'rejected'] } },
            });
            status = 'duplicate';
            isDuplicate = true;
            duplicateOfId = conflict?.id || null;
            suspicionReason = `تطابق قطعي على مستوى قاعدة البيانات: قيد الفرادة منع تكرار رقم العملية (${transactionId})`;

            return await tx.bankakReceipt.create({
              data: {
                receiptNumber,
                transactionId,
                customerId: customerId || null,
                customerSessionId: customerSessionId || null,
                senderName,
                senderAccount,
                receiverName,
                receiverAccount,
                amount,
                currency: 'SDG',
                transactionDate,
                transactionTime,
                bankName: 'بنكك - بنك الخرطوم',
                ocrText: rawOcrText || parsed.rawText,
                ocrConfidence: parsed.ocrConfidence,
                imageStorageKey,
                imageHash,
                status: 'duplicate',
                duplicateOfId,
                isSuspicious: false,
                suspicionReason,
                createdBy: user.name,
              },
              include: {
                customer: true,
                customerSession: true,
              },
            });
          }
          throw dbErr;
        }
      }, { maxWait: 15000, timeout: 30000 });

      // Auto-Verify & Auto-Approve non-duplicate, non-suspicious receipts with valid amount > 0
      let finalReceipt = receipt;
      let autoApproved = false;
      let autoApproveError: string | null = null;

      if (
        !isDuplicate &&
        !isSuspicious &&
        Number(receipt.amount) > 0 &&
        receipt.status !== 'duplicate' &&
        receipt.status !== 'rejected'
      ) {
        try {
          const approvedRes = await approveBankakReceiptAtomic({
            receiptId: receipt.id,
            userId: user.userId,
            userName: user.name,
            userRole: user.role,
            directVerification: true,
            allowAutoApproval: true,
            verificationSource: 'auto_upload_approval',
            verificationNotes: 'تم التحقق البنكي والاعتماد المالي تلقائياً عند رفع الإيصال',
          });
          finalReceipt = approvedRes.receipt;
          autoApproved = true;
        } catch (autoErr: any) {
          autoApproveError = autoErr.message || 'تعذر الاعتماد التلقائي';
          console.warn(`[Auto-Approve Warning] Receipt ${receipt.receiptNumber}: ${autoApproveError}`);
        }
      }

      // Append newly created receipt to in-memory existing list for in-flight duplicate checks
      existingReceipts.push({
        id: finalReceipt.id,
        receiptNumber: finalReceipt.receiptNumber,
        transactionId: finalReceipt.transactionId,
        imageHash: finalReceipt.imageHash,
        amount: finalReceipt.amount,
        transactionDate: finalReceipt.transactionDate,
        senderName: finalReceipt.senderName,
        status: finalReceipt.status,
        customer: finalReceipt.customer ? { name: finalReceipt.customer.name } : null,
      });

      // Dispatch targeted contextual notifications for duplicates/suspicious/unapproved items
      if (isDuplicate) {
        await createNotification({
          type: 'duplicate_receipt',
          title: 'تحذير حاسم: اكتشاف إيصال بنكك مكرر!',
          message: riskAssessment.reason || `تم اكتشاف إيصال مكرر برقم عملية ${transactionId} بمبلغ ${amount.toLocaleString()} SDG`,
          referenceType: 'BankakReceipt',
          referenceId: finalReceipt.id,
          recipientRole: 'accountant',
          priority: 'urgent',
        });
      } else if (isSuspicious) {
        await createNotification({
          type: 'suspicious_receipt',
          title: 'تنبيه: إيصال مشتبه به يحتاج تدقيقاً إضافياً',
          message: riskAssessment.reason || `إيصال بمبلغ ${amount.toLocaleString()} SDG يطابق خصائص إيصال سابق`,
          referenceType: 'BankakReceipt',
          referenceId: finalReceipt.id,
          recipientRole: 'accountant',
          priority: 'high',
        });
      } else if (!autoApproved) {
        await createNotification({
          type: 'receipt_uploaded',
          title: 'إيصال بنكك جديد بانتظار المراجعة',
          message: `تم رفع إيصال برقم ${transactionId} بمبلغ ${amount.toLocaleString()} SDG للعميل ${finalReceipt.customer?.name || 'عام'}${autoApproveError ? ` (${autoApproveError})` : ''}`,
          referenceType: 'BankakReceipt',
          referenceId: finalReceipt.id,
          recipientRole: 'accountant',
          priority: 'normal',
        });
      }

      results.push({
        ...finalReceipt,
        isDuplicate,
        isSuspicious,
        autoApproved,
        autoApproveError,
        riskReason: suspicionReason,
        ocrDiagnostics: ocrResult.diagnostics,
        ocrWarnings: parsed.ocrWarnings,
      });

      const itemDuration = Date.now() - itemStartTime;
      console.log(`[OCR Performance] Item ${i + 1}/${items.length}: Total=${itemDuration}ms (OCR=${ocrResult.durationMs}ms, Engine=${ocrResult.engineUsed}, Status=${receipt.status})`);
    }

    await logAuditEvent({
      userId: user.userId,
      action: 'BATCH_RECEIPTS_UPLOAD',
      entityType: 'BankakReceipt',
      newValues: {
        count: results.length,
        duplicates: results.filter((r) => r.isDuplicate).length,
        suspicious: results.filter((r) => r.isSuspicious).length,
      },
      reason: `رفع دفعة إيصالات بنكك (${results.length} إيصال)`,
    });

    return NextResponse.json({
      success: true,
      count: results.length,
      data: results,
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error in batch receipts upload:', error);
    return NextResponse.json({ error: error.message || 'خطأ في معالجة الإيصالات' }, { status: 500 });
  }
}
