import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { parseBankakReceiptText, computeImageHash } from '@/lib/ocr/bankak-parser';
import { processReceiptImageWithOcr } from '@/lib/ocr/image-ocr';
import { logAuditEvent } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const body = await req.json();
    // Support either single object or array of receipts
    const items = Array.isArray(body.items) ? body.items : [body];

    const results = [];

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

      // Check for duplicate receipt
      const existingReceipt = await prisma.bankakReceipt.findFirst({
        where: {
          OR: [
            { transactionId: transactionId },
            { imageHash: imageHash },
          ],
        },
        include: { customer: true },
      });

      let status = 'pending_review';
      let duplicateOfId = null;

      if (existingReceipt) {
        status = 'duplicate';
        duplicateOfId = existingReceipt.id;
      }

      const receiptNumber = `RCP-${Date.now()}-${i + 1}`;

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
          imageStorageKey: imageData ? (imageData.length > 500 ? imageData.substring(0, 500) : imageData) : 'no-image',
          imageHash,
          status,
          duplicateOfId,
          createdBy: user.name,
        },
        include: {
          customer: true,
          customerSession: true,
        },
      });

      if (status === 'duplicate') {
        // Create duplicate notification
        await prisma.notification.create({
          data: {
            userId: user.userId,
            type: 'duplicate_receipt',
            title: 'تحذير: إيصال بنكك مكرر',
            message: `تم اكتشاف إيصال مكرر برقم عملية ${transactionId} بمبلغ ${amount.toLocaleString()} SDG مسجل مسبقاً للعميل ${existingReceipt?.customer?.name || 'غير معروف'}`,
            referenceType: 'BankakReceipt',
            referenceId: receipt.id,
          },
        });
      }

      results.push({
        ...receipt,
        isDuplicate: status === 'duplicate',
        duplicateDetails: existingReceipt
          ? {
              originalReceiptNumber: existingReceipt.receiptNumber,
              customerName: existingReceipt.customer?.name,
              createdAt: existingReceipt.createdAt,
            }
          : null,
      });
    }

    await logAuditEvent({
      userId: user.userId,
      action: 'BATCH_RECEIPTS_UPLOAD',
      entityType: 'BankakReceipt',
      newValues: { count: results.length, duplicates: results.filter((r) => r.isDuplicate).length },
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
