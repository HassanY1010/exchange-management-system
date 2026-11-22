import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { parseBankakReceiptText, computeImageHash, evaluateReceiptRisk } from '@/lib/ocr/bankak-parser';
import { processReceiptImageWithOcr } from '@/lib/ocr/image-ocr';
import { uploadReceiptImage } from '@/lib/storage/supabase-storage';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';
import { getSystemSetting } from '@/lib/settings/settings-service';

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
      // Low OCR confidence or missing critical fields mandates manual review status
      if (status === 'pending_verification' && (parsed.ocrConfidence < 70 || amount <= 0 || !transactionId || parsed.extractedFieldsCount < 2)) {
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
          // Acquire transaction-scoped advisory lock on transactionId
          await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', transactionId);

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
      });

      // Append newly created receipt to in-memory existing list for in-flight duplicate checks
      existingReceipts.push({
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        transactionId: receipt.transactionId,
        imageHash: receipt.imageHash,
        amount: receipt.amount,
        transactionDate: receipt.transactionDate,
        senderName: receipt.senderName,
        status: receipt.status,
        customer: receipt.customer ? { name: receipt.customer.name } : null,
      });

      // Dispatch targeted contextual notifications
      if (isDuplicate) {
        await createNotification({
          type: 'duplicate_receipt',
          title: 'تحذير حاسم: اكتشاف إيصال بنكك مكرر!',
          message: riskAssessment.reason || `تم اكتشاف إيصال مكرر برقم عملية ${transactionId} بمبلغ ${amount.toLocaleString()} SDG`,
          referenceType: 'BankakReceipt',
          referenceId: receipt.id,
          recipientRole: 'accountant',
          priority: 'urgent',
        });
      } else if (isSuspicious) {
        await createNotification({
          type: 'suspicious_receipt',
          title: 'تنبيه: إيصال مشتبه به يحتاج تدقيقاً إضافياً',
          message: riskAssessment.reason || `إيصال بمبلغ ${amount.toLocaleString()} SDG يطابق خصائص إيصال سابق`,
          referenceType: 'BankakReceipt',
          referenceId: receipt.id,
          recipientRole: 'accountant',
          priority: 'high',
        });
      } else {
        await createNotification({
          type: 'receipt_uploaded',
          title: 'إيصال بنكك جديد بانتظار التحقق',
          message: `تم رفع إيصال جديد برقم ${transactionId} بمبلغ ${amount.toLocaleString()} SDG للعميل ${receipt.customer?.name || 'عام'}`,
          referenceType: 'BankakReceipt',
          referenceId: receipt.id,
          recipientRole: 'accountant',
          priority: 'normal',
        });

        const minOcrConfidence = await getSystemSetting<number>('ocr_min_confidence', 70);
        if (parsed.ocrConfidence < minOcrConfidence) {
          await createNotification({
            type: 'pending_review',
            title: 'دقة قراءة منخفضة للإيصال (OCR)',
            message: `دقة استخراج الإيصال رقم ${transactionId} بلغت ${parsed.ocrConfidence}%. يتطلب مراجعة يدوية وتعديلاً قبل الاعتماد`,
            referenceType: 'BankakReceipt',
            referenceId: receipt.id,
            recipientRole: 'data_entry',
            priority: 'normal',
          });
        }
      }

      results.push({
        ...receipt,
        isDuplicate,
        isSuspicious,
        riskReason: suspicionReason,
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
