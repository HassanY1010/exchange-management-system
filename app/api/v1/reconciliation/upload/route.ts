import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية استيراد كشف الحساب البنكي مقتصرة على المحاسب أو مدير النظام' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { filename, bankAccountId, rawText, lines = [] } = body;

    let parsedLines = lines;

    // If rawText (CSV or tabular format) is provided, parse it
    if ((!parsedLines || parsedLines.length === 0) && rawText) {
      const textLines = rawText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      parsedLines = [];

      for (let i = 0; i < textLines.length; i++) {
        const line = textLines[i];
        if (i === 0 && (line.includes('رقم') || line.includes('Transaction') || line.includes('Date'))) {
          continue; // skip header row
        }
        // Split by comma or tab or semicolon
        const cols = line.split(/[,;\t|]/).map((c: string) => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length >= 2) {
          // Columns expectation: [Date, TxnId, Amount, Sender, Beneficiary] or flexible
          const txnId = cols[1] || cols[0];
          const rawAmount = cols[2] ? cols[2].replace(/,/g, '') : cols[1].replace(/,/g, '');
          const amount = parseFloat(rawAmount) || 0;
          const date = cols[0].length >= 8 ? cols[0] : new Date().toISOString().slice(0, 10);
          const sender = cols[3] || 'غير محدد';
          const beneficiary = cols[4] || 'مكتب الصرافة';

          if (txnId && amount > 0) {
            parsedLines.push({
              transactionId: txnId,
              amount,
              transactionDate: date,
              senderName: sender,
              beneficiaryName: beneficiary,
              description: `حوالة واردة بنكك - ${txnId}`,
            });
          }
        }
      }
    }

    if (!parsedLines || parsedLines.length === 0) {
      return NextResponse.json({ error: 'لم يتم العثور على أي حركات بنكية صالحة في الملف المستورد' }, { status: 400 });
    }

    const statementNumber = `STMT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

    const statement = await prisma.bankStatement.create({
      data: {
        statementNumber,
        filename: filename || `bankak-statement-${Date.now()}.csv`,
        accountId: bankAccountId || null,
        totalLines: parsedLines.length,
        matchedLines: 0,
        unmatchedLines: parsedLines.length,
        status: 'uploaded',
        importedBy: user.name,
        lines: {
          create: parsedLines.map((p: any) => ({
            transactionId: p.transactionId,
            amount: Number(p.amount),
            currency: 'SDG',
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

    await logAuditEvent({
      userId: user.userId,
      action: 'IMPORT_BANK_STATEMENT',
      entityType: 'BankStatement',
      entityId: statement.id,
      newValues: { statementNumber, totalLines: parsedLines.length },
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

    return NextResponse.json({
      success: true,
      message: `تم استيراد كشف الحساب بنجاح (${statement.totalLines} حركة بنكية)`,
      data: statement,
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error importing bank statement:', error);
    return NextResponse.json({ error: error.message || 'خطأ أثناء استيراد كشف الحساب' }, { status: 500 });
  }
}
