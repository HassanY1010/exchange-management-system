import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import { getSystemSettings } from '@/lib/settings/settings-service';
import { generateCustomerStatement, StatementCurrency } from '@/lib/customers/customer-statement-service';
import { buildCustomerStatementPdf } from '@/lib/pdf/customer-statement-pdf';
import { logAuditEvent } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const allowedRoles = ['admin', 'accountant', 'data_entry', 'custody_officer'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتصدير كشف حساب العميل بصيغة PDF', success: false },
      { status: 403 }
    );
  }

  const isDataEntry = user.role === 'data_entry';
  const { searchParams } = new URL(req.url);
  const currencyParam = (searchParams.get('currency') || 'EGP').toUpperCase();
  const currency: StatementCurrency = currencyParam === 'SDG' ? 'SDG' : 'EGP';
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');
  const asOfParam = searchParams.get('asOf');
  const asOfTimestamp = asOfParam ? new Date(asOfParam) : null;
  const disposition = searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';

  try {
    const [statement, settings] = await Promise.all([
      generateCustomerStatement({
        customerId: params.id,
        currency,
        fromDate,
        toDate,
        asOfTimestamp: asOfTimestamp && !isNaN(asOfTimestamp.getTime()) ? asOfTimestamp : null,
        isDataEntry,
      }),
      getSystemSettings(),
    ]);

    if (!statement) {
      return NextResponse.json({ error: 'العميل غير موجود في النظام', success: false }, { status: 404 });
    }

    const pdfBuffer = await buildCustomerStatementPdf(
      statement,
      {
        name: settings.company_name || 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING)',
        phone: settings.company_phone || '+20 100 000 0000',
        address: settings.company_address || 'القاهرة، جمهورية مصر العربية',
        taxNumber: isDataEntry ? undefined : settings.company_tax_number || '100-200-300',
      },
      user.name
    );

    await logAuditEvent({
      userId: user.userId,
      action: 'EXPORT_CUSTOMER_STATEMENT_PDF',
      entityType: 'Customer',
      entityId: statement.customer.id,
      newValues: {
        currency,
        fromDate: fromDate || 'ALL',
        toDate: toDate || 'ALL',
        rowsCount: statement.rows.length,
        closingBalance: statement.closingBalance,
      },
      reason: `تصدير كشف حساب PDF للعميل ${statement.customer.name} (${statement.customer.code}) بعملة ${currency}`,
    });

    const todayStr = new Date().toISOString().split('T')[0];
    const safeName = statement.customer.name.replace(/[\\/:*?"<>|]/g, '_');
    const utf8Filename = encodeURIComponent(`كشف_حساب_${safeName}_${currency}_${todayStr}.pdf`);
    const asciiFallback = `statement_${statement.customer.code}_${currency}_${todayStr}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${utf8Filename}`,
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('Error generating customer statement PDF:', error);
    return NextResponse.json(
      { error: error.message || 'حدث خطأ أثناء إنشاء ملف PDF لكشف الحساب', success: false },
      { status: 500 }
    );
  }
}
