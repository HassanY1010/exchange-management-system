import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import type { CustomerStatementResult } from '@/lib/customers/customer-statement-service';

const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Reorders logical RTL Arabic words and LTR numeric/English runs into the
 * visual Left-to-Right token order expected by PDFKit's fontkit renderer.
 * PDFKit natively shapes Arabic characters inside each word when using an
 * Arabic TTF font (Amiri), so we must NOT pre-shape with Presentation Forms.
 */
export function shapeArabicLine(text: string): string {
  if (!text) return '';
  const str = String(text).trim();
  if (!str || !ARABIC_REGEX.test(str)) return str;

  // Tokenize keeping LTR words, numbers, and parenthesized/punctuated LTR runs together
  const tokens: { rtl: boolean; val: string }[] = [];
  const parts = str.split(/\s+/).filter(Boolean);

  for (const part of parts) {
    const isRtl = ARABIC_REGEX.test(part);
    if (!isRtl && tokens.length > 0 && !tokens[tokens.length - 1].rtl) {
      tokens[tokens.length - 1].val += ' ' + part;
    } else {
      tokens.push({ rtl: isRtl, val: part });
    }
  }

  return tokens.reverse().map((t) => t.val).join(' ');
}

/**
 * Wraps logical text to fit `maxWidth` in the current PDFKit font,
 * keeping LTR references/equations intact on one line when possible,
 * and applies RTL token reordering per visual line.
 */
function wrapAndShapeText(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [''];
  const paragraphs = String(text).split(/\r?\n/);
  const visualLines: string[] = [];

  for (const para of paragraphs) {
    // Group " — " or parenthesized LTR expressions gently by splitting on spaces
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      visualLines.push('');
      continue;
    }

    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${currentLine} ${words[i]}`;
      const shapedCandidate = shapeArabicLine(candidate);
      if (doc.widthOfString(shapedCandidate) <= maxWidth) {
        currentLine = candidate;
      } else {
        visualLines.push(shapeArabicLine(currentLine));
        currentLine = words[i];
      }
    }
    visualLines.push(shapeArabicLine(currentLine));
  }

  return visualLines;
}

function fmtMoney(val: number): string {
  const rounded = Math.round(val * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.001;
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function getCurrencyDisplayName(currency: 'EGP' | 'SDG'): string {
  return currency === 'SDG' ? 'جنيه سوداني (بنكك)' : 'جنيه مصري';
}

function getStatusLabel(status: string): string {
  if (status === 'closed') return 'مقفل';
  if (status === 'blocked') return 'محظور';
  return 'نشط ومعتمد';
}

function getRowTypeLabel(type: string): string {
  switch (type) {
    case 'receipt_credit':
      return 'إيداع إشعار بنكك معتمد';
    case 'exchange_entitlement':
      return 'استحقاق صرف مقابل إشعار بنكك';
    case 'cash_payout':
      return 'صرف نقدي (سند صرف)';
    case 'custody_payout':
      return 'تسليم عهدة نقدية';
    case 'sdg_conversion':
      return 'تسوية مقابل صرف نقدي';
    case 'overpayment_refund':
      return 'رد فائض سداد';
    case 'debt_receivable':
      return 'قيد مديونية على العميل';
    case 'debt_payable':
      return 'قيد استحقاق للعميل';
    case 'debt_payment':
      return 'سداد مديونية';
    default:
      return 'حركة مالية';
  }
}

/**
 * Draws a crisp vector official document/file icon (matching Lucide FileText)
 * without relying on emojis or external icon fonts.
 */
function drawOfficialFileIcon(doc: PDFKit.PDFDocument, x: number, y: number, size = 12, color = '#1e3a8a') {
  doc.save();
  doc.strokeColor(color).lineWidth(1.1);
  const fold = size * 0.32;
  // Document outline with folded top-right corner
  doc
    .moveTo(x, y)
    .lineTo(x + size - fold, y)
    .lineTo(x + size, y + fold)
    .lineTo(x + size, y + size * 1.2)
    .lineTo(x, y + size * 1.2)
    .closePath()
    .stroke();
  // Fold crease
  doc
    .moveTo(x + size - fold, y)
    .lineTo(x + size - fold, y + fold)
    .lineTo(x + size, y + fold)
    .stroke();
  // Inner text lines
  doc
    .moveTo(x + size * 0.22, y + size * 0.56)
    .lineTo(x + size * 0.78, y + size * 0.56)
    .stroke();
  doc
    .moveTo(x + size * 0.22, y + size * 0.82)
    .lineTo(x + size * 0.78, y + size * 0.82)
    .stroke();
  doc.restore();
}

export interface PdfCompanyInfo {
  name: string;
  phone?: string;
  address?: string;
  taxNumber?: string;
}

/**
 * Generates an official A4 RTL Arabic Customer Account Statement PDF Buffer.
 * Columns (RTL order from right to left):
 *   1. التاريخ (Date)
 *   2. التفاصيل (Details & Conversion Equations)
 *   3. عليه (Debit)
 *   4. له (Credit)
 *   5. الرصيد (Running Balance)
 */
export async function buildCustomerStatementPdf(
  statement: CustomerStatementResult,
  company: PdfCompanyInfo,
  generatedBy: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const fontsDir = path.join(process.cwd(), 'lib', 'pdf', 'fonts');
      const regularFontPath = path.join(fontsDir, 'Amiri-Regular.ttf');
      const boldFontPath = path.join(fontsDir, 'Amiri-Bold.ttf');
      const logoPath = path.join(process.cwd(), 'public', 'brand', 'logo.png');

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 32, bottom: 36, left: 28, right: 28 },
        bufferPages: true,
        info: {
          Title: `كشف حساب ${statement.customer.name} (${statement.currency})`,
          Author: company.name,
          Subject: `Customer Statement - ${statement.customer.code}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Register bundled Arabic TTF fonts
      if (fs.existsSync(regularFontPath)) {
        doc.registerFont('ArabicRegular', regularFontPath);
      }
      if (fs.existsSync(boldFontPath)) {
        doc.registerFont('ArabicBold', boldFontPath);
      }
      const hasArabicFonts = fs.existsSync(regularFontPath) && fs.existsSync(boldFontPath);
      const fontRegular = hasArabicFonts ? 'ArabicRegular' : 'Helvetica';
      const fontBold = hasArabicFonts ? 'ArabicBold' : 'Helvetica-Bold';

      const pageWidth = doc.page.width; // 595.28 for A4
      const pageHeight = doc.page.height; // 841.89 for A4
      const marginX = 28;
      const contentWidth = pageWidth - marginX * 2; // ~539.28

      // Colors matching the client's reference statement table
      const navy = '#111827';
      const headerBg = '#e5e7eb';
      const slateMuted = '#374151';
      const borderColor = '#374151';
      const debitColor = '#111827';
      const creditColor = '#111827';

      // =====================================================================
      // 1. COMPACT OFFICIAL METADATA BAR + REFERENCE TITLE BANNER
      // =====================================================================
      let y = 26;

      // Subtle company + date metadata line above the main table banner
      doc.font(fontRegular).fontSize(8.5).fillColor('#4b5563');
      const todayStr = new Date().toISOString().split('T')[0];
      const periodLabel =
        statement.fromDate || statement.toDate
          ? `الفترة: من ${statement.fromDate || 'البداية'} إلى ${statement.toDate || 'الآن'}`
          : 'كشف حساب كامل';
      doc.text(
        shapeArabicLine(`${company.name} • كود العميل: ${statement.customer.code} • الحالة: ${getStatusLabel(statement.customer.status)}`),
        marginX,
        y,
        { width: contentWidth, align: 'right', lineBreak: false }
      );
      doc.text(
        shapeArabicLine(`${periodLabel} • تاريخ الإصدار: ${todayStr}`),
        marginX,
        y,
        { width: contentWidth, align: 'left', lineBreak: false }
      );
      y += 18;

      // Exact Reference Title Banner with Official Brand Logo & File Icon
      const currencyDisplay = getCurrencyDisplayName(statement.currency);
      const bannerH = 30;
      doc.rect(marginX, y, contentWidth, bannerH).lineWidth(1).strokeColor('#000000').stroke();
      if (fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, pageWidth - marginX - 28, y + 4, { fit: [22, 22] });
        } catch {
          // Safe fallback if logo image fails to decode
        }
      }
      drawOfficialFileIcon(doc, marginX + 8, y + 7, 11, '#111827');
      doc.font(fontBold).fontSize(11.5).fillColor('#000000');
      doc.text(
        shapeArabicLine(`كشف الحساب # حساب العميل ${statement.customer.name} ${currencyDisplay}`),
        marginX + 26,
        y + 6,
        { width: contentWidth - 58, align: 'center', lineBreak: false }
      );
      y += bannerH + 8;

      // Compact Customer Info & Summary Strip (reduces empty A4 whitespace cleanly)
      const infoH = 38;
      doc.roundedRect(marginX, y, contentWidth, infoH, 4).fillAndStroke('#f8fafc', '#cbd5e1');
      const halfInfoW = contentWidth / 2 - 14;
      doc.font(fontRegular).fontSize(9).fillColor('#1f2937');
      doc.text(
        shapeArabicLine(`اسم العميل: ${statement.customer.name}`),
        pageWidth - marginX - 10 - halfInfoW,
        y + 6,
        { width: halfInfoW, align: 'right', lineBreak: false }
      );
      doc.text(
        shapeArabicLine(`رقم الهاتف: ${statement.customer.phone}`),
        pageWidth - marginX - 10 - halfInfoW,
        y + 21,
        { width: halfInfoW, align: 'right', lineBreak: false }
      );
      doc.text(
        shapeArabicLine(`عملة الكشف: ${currencyDisplay}`),
        marginX + 10,
        y + 6,
        { width: halfInfoW, align: 'left', lineBreak: false }
      );
      doc.text(
        shapeArabicLine(`رصيد بداية المدة: ${fmtMoney(statement.openingBalance)} ${statement.currency}`),
        marginX + 10,
        y + 21,
        { width: halfInfoW, align: 'left', lineBreak: false }
      );
      y += infoH + 10;

      // =====================================================================
      // 2. FIVE-COLUMN RTL TABLE DEFINITION (Matching Reference Image)
      // Columns from RIGHT to LEFT:
      //   1. التاريخ (Date)        : 76pt
      //   2. التفاصيل (Details)    : 227.28pt
      //   3. عليه (Debit)          : 78pt
      //   4. له (Credit)           : 78pt
      //   5. الرصيد (Balance)      : 80pt
      // Total = 539.28pt
      // =====================================================================
      const colWidths = {
        balance: 80,
        credit: 78,
        debit: 78,
        details: contentWidth - (80 + 78 + 78 + 76),
        date: 76,
      };

      // X coordinates from LEFT to RIGHT on page
      const colX = {
        balance: marginX,
        credit: marginX + colWidths.balance,
        debit: marginX + colWidths.balance + colWidths.credit,
        details: marginX + colWidths.balance + colWidths.credit + colWidths.debit,
        date: marginX + colWidths.balance + colWidths.credit + colWidths.debit + colWidths.details,
      };

      const drawTableHeader = (startY: number): number => {
        const headerH = 28;
        doc.rect(marginX, startY, contentWidth, headerH).fill(headerBg);
        doc.rect(marginX, startY, contentWidth, headerH).lineWidth(0.75).strokeColor(borderColor).stroke();

        // Vertical dividers in header
        for (const xPos of [colX.credit, colX.debit, colX.details, colX.date]) {
          doc.moveTo(xPos, startY).lineTo(xPos, startY + headerH).lineWidth(0.75).strokeColor(borderColor).stroke();
        }

        doc.font(fontBold).fontSize(10).fillColor('#000000');
        const textY = startY + 6;
        doc.text(shapeArabicLine('الرصيد'), colX.balance + 4, textY, { width: colWidths.balance - 8, align: 'center', lineBreak: false });
        doc.text(shapeArabicLine('له'), colX.credit + 4, textY, { width: colWidths.credit - 8, align: 'center', lineBreak: false });
        doc.text(shapeArabicLine('عليه'), colX.debit + 4, textY, { width: colWidths.debit - 8, align: 'center', lineBreak: false });
        doc.text(shapeArabicLine('رقم العملية'), colX.details + 6, textY, { width: colWidths.details - 12, align: 'center', lineBreak: false });
        doc.text(shapeArabicLine('التاريخ'), colX.date + 4, textY, { width: colWidths.date - 8, align: 'center', lineBreak: false });

        return startY + headerH;
      };

      y = drawTableHeader(y);

      const ensurePageSpace = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - 54) {
          doc.addPage();
          y = 32;
          y = drawTableHeader(y);
        }
      };

      // Optional Opening Balance Row when filtered or non-zero
      if (statement.fromDate || statement.openingBalance !== 0) {
        const openRowH = 22;
        ensurePageSpace(openRowH);
        doc.rect(marginX, y, contentWidth, openRowH).lineWidth(0.6).strokeColor(borderColor).stroke();
        for (const xPos of [colX.credit, colX.debit, colX.details, colX.date]) {
          doc.moveTo(xPos, y).lineTo(xPos, y + openRowH).lineWidth(0.6).strokeColor(borderColor).stroke();
        }

        doc.font(fontBold).fontSize(8.5).fillColor(navy);
        doc.text(fmtMoney(statement.openingBalance), colX.balance + 4, y + 5, { width: colWidths.balance - 8, align: 'center', lineBreak: false });
        doc.text('', colX.credit + 4, y + 5, { width: colWidths.credit - 8, align: 'center', lineBreak: false });
        doc.text('', colX.debit + 4, y + 5, { width: colWidths.debit - 8, align: 'center', lineBreak: false });
        doc.text(shapeArabicLine('رصيد بداية المدة (الرصيد الافتتاحي)'), colX.details + 6, y + 5, { width: colWidths.details - 12, align: 'center', lineBreak: false });
        doc.text(statement.fromDate || '---', colX.date + 4, y + 5, { width: colWidths.date - 8, align: 'center', lineBreak: false });
        y += openRowH;
      }

      // =====================================================================
      // 3. TRANSACTION ROWS
      // =====================================================================
      if (statement.rows.length === 0) {
        const emptyH = 30;
        ensurePageSpace(emptyH);
        doc.rect(marginX, y, contentWidth, emptyH).lineWidth(0.6).strokeColor(borderColor).stroke();
        doc.font(fontRegular).fontSize(9).fillColor(slateMuted);
        doc.text(shapeArabicLine('لا توجد حركات مالية مسجلة في هذه الفترة لهذه العملة'), marginX + 10, y + 8, {
          width: contentWidth - 20,
          align: 'center',
          lineBreak: false,
        });
        y += emptyH;
      } else {
        for (let idx = 0; idx < statement.rows.length; idx++) {
          const row = statement.rows[idx];
          const realOpRef = row.reference && String(row.reference).trim() ? String(row.reference).trim() : '—';
          const rowH = 26;

          ensurePageSpace(rowH);

          // Cell borders
          doc.rect(marginX, y, contentWidth, rowH).lineWidth(0.6).strokeColor(borderColor).stroke();
          for (const xPos of [colX.credit, colX.debit, colX.details, colX.date]) {
            doc.moveTo(xPos, y).lineTo(xPos, y + rowH).lineWidth(0.6).strokeColor(borderColor).stroke();
          }

          const cellY = y + 6;

          // 1. Date
          doc.font(fontRegular).fontSize(9).fillColor(navy);
          doc.text(row.date, colX.date + 3, cellY, {
            width: colWidths.date - 6,
            align: 'center',
            lineBreak: false,
          });

          // 2. Real Operation Number (رقم العملية) + Official File Icon
          drawOfficialFileIcon(doc, colX.details + colWidths.details - 20, cellY + 1, 9.5, '#1e3a8a');
          doc.font(fontBold).fontSize(9).fillColor(navy);
          doc.text(realOpRef, colX.details + 8, cellY, {
            width: colWidths.details - 32,
            align: 'center',
            lineBreak: false,
          });

          // 3. Debit (عليه)
          doc.font(fontRegular).fontSize(9).fillColor(debitColor);
          doc.text(row.debit > 0 ? fmtMoney(row.debit) : '', colX.debit + 4, cellY, {
            width: colWidths.debit - 8,
            align: 'center',
            lineBreak: false,
          });

          // 4. Credit (له)
          doc.font(fontRegular).fontSize(9).fillColor(creditColor);
          doc.text(row.credit > 0 ? fmtMoney(row.credit) : '', colX.credit + 4, cellY, {
            width: colWidths.credit - 8,
            align: 'center',
            lineBreak: false,
          });

          // 5. Running Balance (الرصيد)
          doc.font(fontBold).fontSize(9).fillColor(row.runningBalance < 0 ? '#b91c1c' : navy);
          doc.text(fmtMoney(row.runningBalance), colX.balance + 4, cellY, {
            width: colWidths.balance - 8,
            align: 'center',
            lineBreak: false,
          });

          y += rowH;
        }
      }

      // =====================================================================
      // 4. SUMMARY ROW 1: "اجمالي العمليات" + totalDebit + totalCredit
      // =====================================================================
      const totalRowH = 26;
      const finalRowH = 28;
      ensurePageSpace(totalRowH + finalRowH + 80);

      doc.rect(marginX, y, contentWidth, totalRowH).fill('#f8fafc');
      doc.rect(marginX, y, contentWidth, totalRowH).lineWidth(0.75).strokeColor(borderColor).stroke();
      for (const xPos of [colX.credit, colX.debit, colX.details, colX.date]) {
        doc.moveTo(xPos, y).lineTo(xPos, y + totalRowH).lineWidth(0.75).strokeColor(borderColor).stroke();
      }

      const totY = y + 6;
      doc.font(fontBold).fontSize(9.5).fillColor('#000000');
      doc.text(shapeArabicLine('اجمالي العمليات'), colX.details + 6, totY, {
        width: colWidths.details - 12,
        align: 'center',
        lineBreak: false,
      });
      doc.text(fmtMoney(statement.totalDebit), colX.debit + 4, totY, {
        width: colWidths.debit - 8,
        align: 'center',
        lineBreak: false,
      });
      doc.text(fmtMoney(statement.totalCredit), colX.credit + 4, totY, {
        width: colWidths.credit - 8,
        align: 'center',
        lineBreak: false,
      });

      y += totalRowH;

      // =====================================================================
      // 5. SUMMARY ROW 2: Clear Closing Balance Label + Amount & Currency
      // =====================================================================
      doc.rect(marginX, y, contentWidth, finalRowH).fill('#eff6ff');
      doc.rect(marginX, y, contentWidth, finalRowH).lineWidth(0.9).strokeColor('#000000').stroke();
      doc.moveTo(colX.details, y).lineTo(colX.details, y + finalRowH).lineWidth(0.9).strokeColor('#000000').stroke();

      const finY = y + 7;
      const rightSpanW = colWidths.details + colWidths.date;
      const leftSpanW = colWidths.balance + colWidths.credit + colWidths.debit;

      doc.font(fontBold).fontSize(10).fillColor('#000000');
      const netLabel =
        statement.closingBalance < 0
          ? 'الرصيد المطلوب من العميل:'
          : 'الرصيد المتبقي للعميل:';
      doc.text(shapeArabicLine(netLabel), colX.details + 4, finY, {
        width: rightSpanW - 8,
        align: 'center',
        lineBreak: false,
      });
      doc.text(
        shapeArabicLine(`${fmtMoney(Math.abs(statement.closingBalance))} ${currencyDisplay}`),
        marginX + 4,
        finY,
        { width: leftSpanW - 8, align: 'center', lineBreak: false }
      );

      y += finalRowH + 10;

      // Clear accounting disclosure for EGP statements (contractual rate-based entitlement vs Ledger 2015)
      if (statement.currency === 'EGP') {
        doc.font(fontRegular).fontSize(8).fillColor('#4b5563');
        doc.text(
          shapeArabicLine('ملاحظة: الاستحقاق والمتبقي بعملة EGP محسوبان تعاقدياً من إيصالات SDG المعتمدة بسعر الصرف التاريخي للجلسة وليسا رصيداً مستقلاً في دفتر الأستاذ.'),
          marginX,
          y,
          { width: contentWidth, align: 'right', lineBreak: false }
        );
        y += 18;
      }

      // =====================================================================
      // 6. INDEPENDENT OPERATIONS DETAILS SECTION BELOW THE TABLE
      // =====================================================================
      if (statement.rows.length > 0) {
        const drawDetailsHeader = () => {
          const hdrH = 22;
          doc.rect(marginX, y, contentWidth, hdrH).fill('#f1f5f9');
          doc.rect(marginX, y, contentWidth, hdrH).lineWidth(0.75).strokeColor('#94a3b8').stroke();
          drawOfficialFileIcon(doc, pageWidth - marginX - 20, y + 4.5, 10, '#0f172a');
          doc.font(fontBold).fontSize(9.5).fillColor('#0f172a');
          doc.text(
            shapeArabicLine('تفاصيل العمليات والحركات المالية المرتبطة بأرقامها'),
            marginX + 8,
            y + 4,
            { width: contentWidth - 34, align: 'right', lineBreak: false }
          );
          y += hdrH + 6;
        };

        const ensureDetailsSpace = (neededH: number) => {
          if (y + neededH > pageHeight - 54) {
            doc.addPage();
            y = 32;
            drawDetailsHeader();
          }
        };

        ensureDetailsSpace(56);
        drawDetailsHeader();

        for (const row of statement.rows) {
          const realOpRef = row.reference && String(row.reference).trim() ? String(row.reference).trim() : '—';
          const typeLabel = getRowTypeLabel(row.type);
          const metaParts: string[] = [
            `رقم العملية: ${realOpRef}`,
            `التاريخ: ${row.date}`,
            `النوع: ${typeLabel}`,
          ];
          if (row.sdgAmount && row.sdgAmount > 0) {
            metaParts.push(`المبلغ الأصلي: ${fmtMoney(row.sdgAmount)} SDG`);
          }
          if (row.exchangeRate && row.exchangeRate > 0) {
            metaParts.push(`سعر الصرف: ${fmtMoney(row.exchangeRate)}`);
          }
          if (row.debit > 0) {
            metaParts.push(`عليه: ${fmtMoney(row.debit)} ${row.currency}`);
          }
          if (row.credit > 0) {
            metaParts.push(`له: ${fmtMoney(row.credit)} ${row.currency}`);
          }
          metaParts.push(`الرصيد: ${fmtMoney(row.runningBalance)} ${row.currency}`);

          doc.font(fontBold).fontSize(8);
          const metaLines = wrapAndShapeText(doc, metaParts.join(' • '), contentWidth - 28);
          doc.font(fontRegular).fontSize(8.5);
          const descLines = wrapAndShapeText(doc, row.description || '—', contentWidth - 28);

          const cardH = metaLines.length * 12 + descLines.length * 13 + 12;
          ensureDetailsSpace(cardH + 4);

          doc.roundedRect(marginX, y, contentWidth, cardH, 3).fillAndStroke('#ffffff', '#cbd5e1');
          drawOfficialFileIcon(doc, pageWidth - marginX - 18, y + 6, 9, '#1e3a8a');

          let innerY = y + 5;
          doc.font(fontBold).fontSize(8).fillColor('#1e293b');
          for (const ml of metaLines) {
            doc.text(ml, marginX + 8, innerY, { width: contentWidth - 30, align: 'right', lineBreak: false });
            innerY += 12;
          }
          doc.font(fontRegular).fontSize(8.5).fillColor('#334155');
          for (const dl of descLines) {
            doc.text(dl, marginX + 8, innerY, { width: contentWidth - 30, align: 'right', lineBreak: false });
            innerY += 13;
          }

          y += cardH + 5;
        }
        y += 6;
      }

      // =====================================================================
      // 7. SIGNATURES & FOOTER (Prevent overlap with details section)
      // =====================================================================
      if (y + 72 > pageHeight - 36) {
        doc.addPage();
        y = 32;
      }
      const sigBlockY = Math.max(y + 18, pageHeight - 115);
      if (sigBlockY < pageHeight - 60) {
        y = sigBlockY;
      } else {
        y += 16;
      }

      doc.moveTo(marginX, y - 10).lineTo(pageWidth - marginX, y - 10).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
      doc.font(fontBold).fontSize(9.5).fillColor(slateMuted);
      const sigW = contentWidth / 3;
      doc.text(shapeArabicLine('المحاسب المالي'), marginX + sigW * 2, y, { width: sigW, align: 'center', lineBreak: false });
      doc.text(shapeArabicLine('المدير العام'), marginX + sigW, y, { width: sigW, align: 'center', lineBreak: false });
      doc.text(shapeArabicLine('توقيع العميل بالاستلام'), marginX, y, { width: sigW, align: 'center', lineBreak: false });

      y += 28;
      doc.strokeColor('#94a3b8').lineWidth(0.75).dash(3, { space: 2 });
      doc.moveTo(marginX + sigW * 2 + 25, y).lineTo(marginX + sigW * 3 - 25, y).stroke();
      doc.moveTo(marginX + sigW + 25, y).lineTo(marginX + sigW * 2 - 25, y).stroke();
      doc.moveTo(marginX + 25, y).lineTo(marginX + sigW - 25, y).stroke();
      doc.undash();

      // Add page numbers & footer to every page (set bottom margin = 0 to prevent extra blank page)
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        doc.font(fontRegular).fontSize(7.5).fillColor('#64748b');
        doc.text(
          shapeArabicLine(`تم استخراج الكشف آلياً بواسطة ${generatedBy} • صفحة ${i + 1} من ${range.count}`),
          marginX,
          pageHeight - 24,
          { width: contentWidth, align: 'center', lineBreak: false }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
