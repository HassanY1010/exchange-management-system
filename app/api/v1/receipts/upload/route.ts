import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { parseBankakReceiptText, computeImageHash, evaluateReceiptRisk } from '@/lib/ocr/bankak-parser';
import { processReceiptImageWithOcr } from '@/lib/ocr/image-ocr';
import { uploadReceiptImage } from '@/lib/storage/supabase-storage';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const body = await req.json();
    // Support either single object or array of receipts
    const items = Array.isArray(body.items) ? body.items : [body];

    const results = [];

    // Pre-fetch all non-rejected receipts for multi-attribute risk and duplicate evaluation
    const existingReceipts = await prisma.bankakReceipt.findMany({
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

      // Perform OCR and hash computation using Tesseract.js / Heuristic engine
      const ocrResult = await processReceiptImageWithOcr(
        imageData || `synthetic-${Date.now()}-${i}`,
        rawOcrText || item.ocrText
      );
      const imageHash = ocrResult.imageHash;
      const parsed = ocrResult.parsed;

      // Override with user fields if explicitly provided
      const transactionId = item.transactionId || parsed.transactionId;
      const amount = item.amount !== undefined ? Number(item.amount) : parsed.amount;
      const senderName = item.senderName || parsed.senderName;
      const senderAccount = item.senderAccount || parsed.senderAccount;
      const receiverName = item.receiverName || parsed.receiverName;
      const receiverAccount = item.receiverAccount || parsed.receiverAccount;
      const transactionDate = item.transactionDate || parsed.transactionDate;
      const transactionTime = item.transactionTime || parsed.transactionTime;

      // Comprehensive Anti-Fraud & Risk Assessment (Tier 1 Duplicate, Tier 2 Suspicious)
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

      const status = riskAssessment.status;
      const isDuplicate = riskAssessment.isDuplicate;
      const isSuspicious = riskAssessment.isSuspicious;
      const duplicateOfId = riskAssessment.matchedReceiptId || null;
      const suspicionReason = riskAssessment.reason || null;

      const receiptNumber = `RCP-${Date.now()}-${i + 1}`;

      // Upload to Supabase Storage if configured (fallback to local reference)
      let imageStorageKey = 'no-image';
      if (imageData) {
        const uploadResult = await uploadReceiptImage(imageData, `rcp-${Date.now()}-${transactionId}.png`);
        imageStorageKey = uploadResult.publicUrl || uploadResult.storageKey;
      }

      const receipt = await prisma.bankakReceipt.create({
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

        if (parsed.ocrConfidence < 70) {
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
