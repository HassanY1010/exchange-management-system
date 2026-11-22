import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';
import { parseBankStatementFile } from '@/lib/reconciliation/statement-parser';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية استيراد كشف الحساب البنكي مقتصرة على المحاسب أو مدير النظام' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { filename, bankAccountId, rawText, fileBase64, lines = [] } = body;

    let parsedLines = lines;
    let fileHash = '';

    // If fileBase64 or rawText is provided, parse through robust statement parser
    if (fileBase64 || rawText) {
      const buffer = fileBase64
        ? Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
        : rawText;

      const parseResult = parseBankStatementFile(buffer, filename || 'statement.csv');

      if (!parseResult.success) {
        return NextResponse.json(
          { error: parseResult.error || 'تعذر استخراج حركات بنكية صالحة من الملف' },
          { status: 400 }
        );
      }

      parsedLines = parseResult.validLines;
      fileHash = parseResult.fileHash;

      // Check if this exact file was already imported previously (Duplicate file prevention)
      if (fileHash) {
        const existingWithHash = await prisma.bankStatement.findFirst({
          where: { fileStorageKey: fileHash },
        });
        if (existingWithHash) {
          return NextResponse.json(
            {
              error: `هذا الملف تم استيراده مسبقاً برقم كشف ${existingWithHash.statementNumber} بتاريخ ${new Date(existingWithHash.createdAt).toLocaleDateString('ar-EG')}`,
              existingStatementId: existingWithHash.id,
            },
            { status: 409 }
          );
        }
      }
    }

    if (!parsedLines || parsedLines.length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على أي حركات بنكية صالحة في الملف المستورد' },
        { status: 400 }
      );
    }

    const statementNumber = `STMT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Atomic transaction for statement and lines creation
    const statement = await prisma.$transaction(async (tx) => {
      return await tx.bankStatement.create({
        data: {
          statementNumber,
          filename: filename || `bankak-statement-${Date.now()}.csv`,
          fileStorageKey: fileHash || null,
          accountId: bankAccountId || null,
          totalLines: parsedLines.length,
          matchedLines: 0,
          unmatchedLines: parsedLines.length,
          status: 'uploaded',
          importedBy: user.name,
          lines: {
            create: parsedLines.map((p: any) => ({
              transactionId: String(p.transactionId).trim(),
              amount: Number(p.amount),
              currency: p.currency || 'SDG',
              transactionDate: p.transactionDate || new Date().toISOString().slice(0, 10),
              transactionTime: p.transactionTime || '12:00:00',
              senderName: p.senderName || null,
              beneficiaryName: p.beneficiaryName || null,
              description: p.description || null,
              matchStatus: 'unmatched',
            })),
          },
        },
        include: {
          lines: true,
        },
      });
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'IMPORT_BANK_STATEMENT',
      entityType: 'BankStatement',
      entityId: statement.id,
      newValues: { statementNumber, totalLines: parsedLines.length, fileHash },
      reason: `استيراد كشف حساب بنكك (${parsedLines.length} حركة)`,
    });

    await createNotification({
      type: 'pending_review',
      title: 'تم استيراد كشف حساب بنكك وجاهز للمطابقة',
      message: `تم استيراد كشف حساب جديد برقم ${statement.statementNumber} يتضمن ${parsedLines.length} حركة بنكية جاهزة للمطابقة مع الإيصالات`,
      referenceType: 'BankStatement',
      referenceId: statement.id,
      recipientRole: 'accountant',
      priority: 'normal',
    });

    return NextResponse.json(
      {
        success: true,
        message: `تم استيراد كشف الحساب بنجاح (${statement.totalLines} حركة بنكية)`,
        data: statement,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error importing bank statement:', error);
    return NextResponse.json(
      { error: error.message || 'خطأ أثناء استيراد كشف الحساب' },
      { status: 500 }
    );
  }
}
