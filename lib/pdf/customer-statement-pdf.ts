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
 * then shapes & BiDi-reorders each resulting visual line independently
 * so multi-line Arabic paragraphs read top-to-bottom, right-to-left.
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
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      visualLines.push('');
      continue;
    }

    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${currentLine} ${words[i]}`;
      // Measure shaped candidate width accurately
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

      // Exact Reference Title Banner: "كشف الحساب#حساب العميل [الاسم] [العملة]"
      const currencyDisplay = getCurrencyDisplayName(statement.currency);
      const bannerH = 26;
      doc.rect(marginX, y, contentWidth, bannerH).lineWidth(1).strokeColor('#000000').stroke();
      doc.font(fontBold).fontSize(11).fillColor('#000000');
      doc.text(
        shapeArabicLine(`كشف الحساب # حساب العميل ${statement.customer.name} ${currencyDisplay}`),
        marginX + 6,
        y + 5,
        { width: contentWidth - 12, align: 'center', lineBreak: false }
      );
      y += bannerH + 8;

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
        const headerH = 24;
        doc.rect(marginX, startY, contentWidth, headerH).fill(headerBg);
        doc.rect(marginX, startY, contentWidth, headerH).lineWidth(0.75).strokeColor(borderColor).stroke();

        // Vertical dividers in header
        for (const xPos of [colX.credit, colX.debit, colX.details, colX.date]) {
          doc.moveTo(xPos, startY).lineTo(xPos, startY + headerH).lineWidth(0.75).strokeColor(borderColor).stroke();
        }

        doc.font(fontBold).fontSize(9.5).fillColor('#000000');
        const textY = startY + 5;
        doc.text(shapeArabicLine('الرصيد'), colX.balance + 4, textY, { width: colWidths.balance - 8, align: 'center', lineBreak: false });
        doc.text(shapeArabicLine('له'), colX.credit + 4, textY, { width: colWidths.credit - 8, align: 'center', lineBreak: false });
        doc.text(shapeArabicLine('عليه'), colX.debit + 4, textY, { width: colWidths.debit - 8, align: 'center', lineBreak: false });
        doc.text(shapeArabicLine('التفاصيل'), colX.details + 6, textY, { width: colWidths.details - 12, align: 'center', lineBreak: false });
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
          doc.font(fontRegular).fontSize(8.5);
          const wrappedDetails = wrapAndShapeText(doc, row.description, colWidths.details - 14);
          const lineHeight = 12.5;
          const rowH = Math.max(22, wrappedDetails.length * lineHeight + 8);

          ensurePageSpace(rowH);

          // Cell borders
          doc.rect(marginX, y, contentWidth, rowH).lineWidth(0.6).strokeColor(borderColor).stroke();
          for (const xPos of [colX.credit, colX.debit, colX.details, colX.date]) {
            doc.moveTo(xPos, y).lineTo(xPos, y + rowH).lineWidth(0.6).strokeColor(borderColor).stroke();
          }

          const cellY = y + 4;

          // 1. Date (DD-MM-YYYY or YYYY-MM-DD)
          doc.font(fontRegular).fontSize(8.5).fillColor(navy);
          doc.text(row.date, colX.date + 3, cellY, {
            width: colWidths.date - 6,
            align: 'center',
            lineBreak: false,
          });

          // 2. Details (multi-line shaped RTL)
          doc.font(fontRegular).fontSize(8.5).fillColor(navy);
          wrappedDetails.forEach((visLine, lineIdx) => {
            doc.text(visLine, colX.details + 6, cellY + lineIdx * lineHeight, {
              width: colWidths.details - 12,
              align: 'center',
              lineBreak: false,
            });
          });

          // 3. Debit (عليه) - empty when 0 just like reference image
          doc.font(fontRegular).fontSize(8.5).fillColor(debitColor);
          doc.text(row.debit > 0 ? fmtMoney(row.debit) : '', colX.debit + 4, cellY, {
            width: colWidths.debit - 8,
            align: 'center',
            lineBreak: false,
          });

          // 4. Credit (له) - empty when 0 just like reference image
          doc.font(fontRegular).fontSize(8.5).fillColor(creditColor);
          doc.text(row.credit > 0 ? fmtMoney(row.credit) : '', colX.credit + 4, cellY, {
            width: colWidths.credit - 8,
            align: 'center',
            lineBreak: false,
          });

          // 5. Running Balance (الرصيد)
          doc.font(fontRegular).fontSize(8.5).fillColor(row.runningBalance < 0 ? '#b91c1c' : navy);
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
      const totalRowH = 22;
      const finalRowH = 24;
      ensurePageSpace(totalRowH + finalRowH + 70);

      doc.rect(marginX, y, contentWidth, totalRowH).lineWidth(0.6).strokeColor(borderColor).stroke();
      for (const xPos of [colX.credit, colX.debit, colX.details, colX.date]) {
        doc.moveTo(xPos, y).lineTo(xPos, y + totalRowH).lineWidth(0.6).strokeColor(borderColor).stroke();
      }

      const totY = y + 5;
      doc.font(fontBold).fontSize(9).fillColor('#000000');
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
      // 5. SUMMARY ROW 2: "الإجمالي - له" | "[closingBalance] [currencyName]"
      // =====================================================================
      doc.rect(marginX, y, contentWidth, finalRowH).lineWidth(0.75).strokeColor('#000000').stroke();
      // Single vertical split at colX.details (separating right 2 cols from left 3 cols)
      doc.moveTo(colX.details, y).lineTo(colX.details, y + finalRowH).lineWidth(0.75).strokeColor('#000000').stroke();

      const finY = y + 6;
      const rightSpanW = colWidths.details + colWidths.date;
      const leftSpanW = colWidths.balance + colWidths.credit + colWidths.debit;

      doc.font(fontBold).fontSize(9.5).fillColor('#000000');
      const netLabel = statement.closingBalance < 0 ? 'الإجمالي - عليه' : 'الإجمالي - له';
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

      y += finalRowH + 8;

      // Clear accounting disclosure for EGP statements (contractual rate-based entitlement vs Ledger 2015)
      if (statement.currency === 'EGP') {
        doc.font(fontRegular).fontSize(7.5).fillColor('#4b5563');
        doc.text(
          shapeArabicLine('ملاحظة: الاستحقاق والمتبقي بعملة EGP محسوبان تعاقدياً من إيصالات SDG المعتمدة بسعر الصرف التاريخي للجلسة وليسا رصيداً مستقلاً في دفتر الأستاذ.'),
          marginX,
          y,
          { width: contentWidth, align: 'right', lineBreak: false }
        );
        y += 16;
      } else {
        y += 12;
      }

      // =====================================================================
      // 6. SIGNATURES & FOOTER ON ALL PAGES
      // =====================================================================
      doc.font(fontBold).fontSize(9).fillColor(slateMuted);
      const sigW = contentWidth / 3;
      doc.text(shapeArabicLine('المحاسب المالي'), marginX + sigW * 2, y, { width: sigW, align: 'center', lineBreak: false });
      doc.text(shapeArabicLine('المدير العام'), marginX + sigW, y, { width: sigW, align: 'center', lineBreak: false });
      doc.text(shapeArabicLine('توقيع العميل بالاستلام'), marginX, y, { width: sigW, align: 'center', lineBreak: false });

      y += 26;
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
