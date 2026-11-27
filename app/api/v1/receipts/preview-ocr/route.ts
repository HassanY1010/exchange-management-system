import { NextRequest, NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { evaluateReceiptRisk } from '@/lib/ocr/bankak-parser';
import { processReceiptImageWithOcr } from '@/lib/ocr/image-ocr';
import { signOcrPreviewToken } from '@/lib/ocr/preview-token';

/**
 * Read-only OCR preview endpoint for customer operation batches.
 * Extracts Bankak receipt fields and evaluates duplicate/suspicious risk
 * WITHOUT uploading images to storage, creating DB records, or posting ledger entries.
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const allowedRoles = ['admin', 'accountant', 'data_entry', 'bankak_auditor'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بمعاينة إيصالات بنكك', success: false },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
    const items = Array.isArray(body.items) ? body.items : [body];

    if (!customerId) {
      return NextResponse.json({ error: 'معرف العميل مطلوب لمعاينة الإيصالات', success: false }, { status: 400 });
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'لم يتم توفير أي صور للمعاينة', success: false }, { status: 400 });
    }

    if (items.length > 50) {
      return NextResponse.json(
        { error: 'الحد الأقصى لمعاينة الإيصالات في الدفعة الواحدة هو 50 إيصال', success: false },
        { status: 400 }
      );
    }

    // Fetch existing non-rejected receipts (read-only) for duplicate & suspicious risk checks
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

    const inBatchReceipts: Array<{
      id: string;
      transactionId: string;
      imageHash: string;
      amount: any;
      transactionDate: string | null;
      senderName: string | null;
      status: string;
    }> = [...existingReceipts];

    const previewResults = [];
    let totalExtractedSdgD = new Decimal(0);
    let eligibleTotalSdgD = new Decimal(0);
    let extractedWithAmountCount = 0;
    let eligibleCount = 0;
    let duplicateCount = 0;
    let suspiciousCount = 0;
    let needsReviewCount = 0;
    let failedOcrCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const imageData = item?.imageData;
      const fileName = item?.fileName || `receipt-${i + 1}`;

      if (!imageData || typeof imageData !== 'string') {
        failedOcrCount++;
        previewResults.push({
          index: i,
          fileName,
          success: false,
          error: 'بيانات الصورة غير صالحة',
          transactionId: '',
          amount: 0,
          currency: 'SDG',
          transactionDate: '',
          transactionTime: '',
          receiverName: '',
          senderAccount: '',
          receiverAccount: '',
          ocrConfidence: 0,
          projectedStatus: 'failed',
          eligibleForAutoApprove: false,
          isDuplicate: false,
          isSuspicious: false,
          riskReason: 'بيانات الصورة مفقودة أو غير صالحة',
        });
        continue;
      }

      if (imageData.startsWith('data:')) {
        const match = imageData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-\+\.]+);base64,/);
        if (match) {
          const mime = match[1].toLowerCase();
          const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
          if (!allowedMimes.includes(mime)) {
            return NextResponse.json(
              {
                error: `نوع الملف (${mime}) غير مدعوم. يرجى استخدام PNG أو JPG أو JPEG أو WebP`,
                success: false,
              },
              { status: 400 }
            );
          }
        }
      }

      if (imageData.length > 20 * 1024 * 1024) {
        return NextResponse.json(
          { error: 'حجم صورة الإيصال يتجاوز الحد الأقصى المسموح به (15 ميغابايت)', success: false },
          { status: 400 }
        );
      }

      const ocrResult = await processReceiptImageWithOcr(imageData);
      const parsed = ocrResult.parsed;
      const amountNum = Number(parsed.amount || 0);
      const transactionId = (parsed.transactionId || '').trim();
      const receiverName = (parsed.receiverName || '').trim();

      const riskAssessment = evaluateReceiptRisk(
        {
          transactionId,
          imageHash: ocrResult.imageHash,
          amount: amountNum,
          transactionDate: parsed.transactionDate,
          senderName: (parsed.senderName || '').trim(),
        },
        inBatchReceipts
      );

      let projectedStatus: string = riskAssessment.status;
      if (
        projectedStatus === 'pending_verification' &&
        (parsed.ocrConfidence < 70 ||
          amountNum <= 0 ||
          !transactionId ||
          !receiverName ||
          !parsed.dateValid ||
          parsed.amountNeedsReview ||
          parsed.extractedFieldsCount < 2)
      ) {
        projectedStatus = 'pending_review';
      }

      const isDuplicate = riskAssessment.isDuplicate;
      const isSuspicious = riskAssessment.isSuspicious;
      // Exact same eligibility rule as upload/route.ts lines 303-309
      const eligibleForAutoApprove =
        !isDuplicate &&
        !isSuspicious &&
        amountNum > 0 &&
        projectedStatus !== 'duplicate' &&
        projectedStatus !== 'rejected';

      if (amountNum > 0) {
        extractedWithAmountCount++;
        totalExtractedSdgD = totalExtractedSdgD.plus(new Decimal(amountNum.toString()));
      } else {
        failedOcrCount++;
      }

      if (isDuplicate) {
        duplicateCount++;
      } else if (isSuspicious) {
        suspiciousCount++;
      } else if (projectedStatus === 'pending_review') {
        needsReviewCount++;
      }

      if (eligibleForAutoApprove) {
        eligibleCount++;
        eligibleTotalSdgD = eligibleTotalSdgD.plus(new Decimal(amountNum.toString()));
      }

      inBatchReceipts.push({
        id: `preview-${i + 1}`,
        transactionId,
        imageHash: ocrResult.imageHash,
        amount: amountNum,
        transactionDate: parsed.transactionDate || null,
        senderName: parsed.senderName || null,
        status: projectedStatus,
      });

      const previewToken = signOcrPreviewToken({
        imageHash: ocrResult.imageHash,
        userId: user.userId,
        customerId,
        parsed,
        rawText: ocrResult.rawText,
      });

      previewResults.push({
        index: i,
        fileName,
        success: amountNum > 0,
        imageHash: ocrResult.imageHash,
        previewToken,
        transactionId,
        amount: amountNum,
        currency: 'SDG',
        transactionDate: parsed.transactionDate || '',
        transactionTime: parsed.transactionTime || '',
        receiverName,
        senderAccount: parsed.senderAccount || '',
        receiverAccount: parsed.receiverAccount || '',
        ocrConfidence: parsed.ocrConfidence,
        amountNeedsReview: Boolean(parsed.amountNeedsReview),
        dateValid: Boolean(parsed.dateValid),
        extractedFieldsCount: parsed.extractedFieldsCount,
        projectedStatus,
        eligibleForAutoApprove,
        isDuplicate,
        isSuspicious,
        riskReason: riskAssessment.reason || null,
        engineUsed: ocrResult.engineUsed,
        durationMs: ocrResult.durationMs,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        items: previewResults,
        summary: {
          totalFiles: items.length,
          extractedWithAmountCount,
          eligibleCount,
          duplicateCount,
          suspiciousCount,
          needsReviewCount,
          failedOcrCount,
          totalExtractedSdg: totalExtractedSdgD.toNumber(),
          eligibleTotalSdg: eligibleTotalSdgD.toNumber(),
        },
      },
    });
  } catch (error: any) {
    console.error('Error in receipt OCR preview:', error);
    return NextResponse.json(
      { error: error?.message || 'حدث خطأ أثناء معاينة الإيصالات بالـ OCR', success: false },
      { status: 500 }
    );
  }
}
