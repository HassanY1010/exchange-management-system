import * as XLSX from 'xlsx';
import crypto from 'crypto';

export interface ParsedStatementLine {
  transactionId: string;
  amount: number;
  currency: string;
  transactionDate: string;
  transactionTime?: string;
  senderName?: string;
  beneficiaryName?: string;
  description?: string;
  rawRowIndex?: number;
}

export interface StatementParseResult {
  success: boolean;
  filename: string;
  fileHash: string;
  totalRows: number;
  validLines: ParsedStatementLine[];
  invalidRows: { row: number; reason: string; rawData: any }[];
  duplicateTxnInFile: string[];
  detectedColumns: { [key: string]: string };
  dateRange: { start?: string; end?: string };
  totalCreditAmount: number;
  error?: string;
}

/**
 * Normalizes Arabic Eastern numerals (٠-٩) to standard Latin numerals (0-9)
 */
export function normalizeNumerals(str: string): string {
  if (!str) return '';
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let res = str;
  for (let i = 0; i < 10; i++) {
    res = res.replace(new RegExp(arabicNumerals[i], 'g'), String(i));
  }
  return res;
}

/**
 * Parses numeric monetary values handling thousands separators, spaces, and signs
 */
export function parseMonetaryAmount(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : Math.abs(val);
  }

  let str = normalizeNumerals(String(val)).trim();
  // Remove currency symbols, quotes, spaces
  str = str.replace(/SDG|EGP|USD|ج\.س|جنيه|[\s'"]/gi, '');

  // Handle European comma decimals if both dot and comma are present
  // e.g., "1.250.000,50" -> 1250000.50
  if (str.includes('.') && str.includes(',')) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // If comma is used as thousands separator e.g. "2,000,000"
    const parts = str.split(',');
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      str = str.replace(/,/g, '');
    } else if (parts.length === 2 && parts[1].length <= 2) {
      // e.g. "2000,50"
      str = str.replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.abs(num);
}

/**
 * Normalizes various date formats into YYYY-MM-DD
 */
export function normalizeDate(dateVal: any): string {
  if (!dateVal) return new Date().toISOString().slice(0, 10);

  // If Excel serial number (e.g. 45250)
  if (typeof dateVal === 'number' && dateVal > 25000 && dateVal < 60000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + dateVal * 86400000);
    return d.toISOString().slice(0, 10);
  }

  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
    return dateVal.toISOString().slice(0, 10);
  }

  const str = normalizeNumerals(String(dateVal)).trim();

  // Pattern YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Pattern DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Fallback parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

/**
 * Known column header aliases for Bank of Khartoum (Bankak) and general banks
 */
const COLUMN_ALIASES = {
  transactionId: [
    'رقم العملية',
    'المرجع',
    'رقم المرجع',
    'رقم الإشعار',
    'رقم الحركة',
    'كود العملية',
    'معرف العملية',
    'transaction id',
    'txn id',
    'transactionid',
    'txnid',
    'ref',
    'reference',
    'ref no',
    'reference no',
    'reference number',
    'trans no',
    'ft number',
  ],
  amount: [
    'المبلغ',
    'دائن',
    'المبلغ المودع',
    'المبلغ الدائن',
    'الوارد',
    'حركات دائنة',
    'القيمة',
    'amount',
    'credit',
    'cr',
    'deposit',
    'credit amount',
    'inflow',
    'net amount',
    'paid in',
  ],
  date: [
    'التاريخ',
    'تاريخ العملية',
    'تاريخ الحركة',
    'تاريخ القيد',
    'تاريخ الإيداع',
    'date',
    'trans date',
    'transaction date',
    'booking date',
    'value date',
    'posting date',
  ],
  sender: [
    'المرسل',
    'من حساب',
    'اسم المحول',
    'المودع',
    'الطرف المحول',
    'اسم المرسل',
    'sender',
    'from',
    'payer',
    'remitter',
    'originator',
    'source',
  ],
  beneficiary: [
    'المستفيد',
    'إلى حساب',
    'اسم المستفيد',
    'الحساب المستلم',
    'الطرف المستلم',
    'beneficiary',
    'to',
    'payee',
    'receiver',
    'destination',
  ],
  description: [
    'الوصف',
    'البيان',
    'تفاصيل',
    'تفاصيل العملية',
    'ملاحظات',
    'نوع المعاملة',
    'description',
    'narrative',
    'details',
    'narration',
    'particulars',
    'memo',
  ],
};

function matchHeaderField(headerText: string): keyof typeof COLUMN_ALIASES | null {
  const clean = headerText.trim().toLowerCase().replace(/[\r\n\t]/g, ' ');
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      if (clean === alias || clean.includes(alias)) {
        return field as keyof typeof COLUMN_ALIASES;
      }
    }
  }
  return null;
}

/**
 * Parses Bank Statement from Excel Buffer (XLSX, XLS) or CSV Raw Text
 */
export function parseBankStatementFile(
  contentBufferOrText: Buffer | string,
  filename: string
): StatementParseResult {
  const result: StatementParseResult = {
    success: false,
    filename: filename || 'unknown-statement.csv',
    fileHash: '',
    totalRows: 0,
    validLines: [],
    invalidRows: [],
    duplicateTxnInFile: [],
    detectedColumns: {},
    dateRange: {},
    totalCreditAmount: 0,
  };

  try {
    // Compute SHA-256 hash of the content to prevent duplicate file uploads
    const hash = crypto.createHash('sha256');
    if (Buffer.isBuffer(contentBufferOrText)) {
      hash.update(contentBufferOrText);
    } else {
      hash.update(Buffer.from(contentBufferOrText, 'utf8'));
    }
    result.fileHash = hash.digest('hex');

    let rows: any[][] = [];

    // Check if content is Excel binary or CSV text
    const isExcel =
      filename.toLowerCase().endsWith('.xlsx') ||
      filename.toLowerCase().endsWith('.xls') ||
      (Buffer.isBuffer(contentBufferOrText) &&
        (contentBufferOrText[0] === 0x50 && contentBufferOrText[1] === 0x4b)); // PK zip header

    if (isExcel) {
      const workbook = XLSX.read(contentBufferOrText, {
        type: Buffer.isBuffer(contentBufferOrText) ? 'buffer' : 'binary',
        cellDates: true,
      });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        result.error = 'ملف Excel لا يحتوي على أي صفحات صالحة';
        return result;
      }

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][];
    } else {
      // Process as CSV / Delimited Text
      const rawText = Buffer.isBuffer(contentBufferOrText)
        ? contentBufferOrText.toString('utf8')
        : contentBufferOrText;

      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // Detect delimiter from first row (comma, semicolon, tab, pipe)
      const firstLine = lines[0] || '';
      let delimiter = ',';
      if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delimiter = ';';
      if ((firstLine.match(/\t/g) || []).length > (firstLine.match(new RegExp(delimiter, 'g')) || []).length) delimiter = '\t';
      if ((firstLine.match(/\|/g) || []).length > (firstLine.match(new RegExp(delimiter, 'g')) || []).length) delimiter = '|';

      rows = lines.map((line) => {
        // Safe CSV line splitter respecting quoted values
        const rowCols: string[] = [];
        let curr = '';
        let inQuote = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"' || char === "'") {
            inQuote = !inQuote;
          } else if (char === delimiter && !inQuote) {
            rowCols.push(curr.trim().replace(/^["']|["']$/g, ''));
            curr = '';
          } else {
            curr += char;
          }
        }
        rowCols.push(curr.trim().replace(/^["']|["']$/g, ''));
        return rowCols;
      });
    }

    if (!rows || rows.length === 0) {
      result.error = 'الملف المستورد فارغ تماماً';
      return result;
    }

    // Find header row (search first 10 rows for matches)
    let headerRowIndex = -1;
    const colIndexMap: { [key in keyof typeof COLUMN_ALIASES]?: number } = {};

    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const candidateRow = rows[r];
      let matchCount = 0;
      const candidateMap: { [key in keyof typeof COLUMN_ALIASES]?: number } = {};

      for (let c = 0; c < candidateRow.length; c++) {
        const cellText = String(candidateRow[c] || '');
        const matched = matchHeaderField(cellText);
        if (matched && candidateMap[matched] === undefined) {
          candidateMap[matched] = c;
          matchCount++;
        }
      }

      // If at least transactionId or amount was found in this row, mark as header
      if (candidateMap.amount !== undefined || candidateMap.transactionId !== undefined || matchCount >= 2) {
        headerRowIndex = r;
        Object.assign(colIndexMap, candidateMap);
        break;
      }
    }

    // If no explicit header matched, apply sensible positional defaults
    if (headerRowIndex === -1) {
      headerRowIndex = 0;
      colIndexMap.date = 0;
      colIndexMap.transactionId = 1;
      colIndexMap.amount = 2;
      colIndexMap.sender = 3;
      colIndexMap.beneficiary = 4;
      colIndexMap.description = 5;
    }

    result.detectedColumns = {
      transactionId: colIndexMap.transactionId !== undefined ? `Col ${colIndexMap.transactionId + 1}` : 'غير محدد',
      amount: colIndexMap.amount !== undefined ? `Col ${colIndexMap.amount + 1}` : 'غير محدد',
      date: colIndexMap.date !== undefined ? `Col ${colIndexMap.date + 1}` : 'غير محدد',
      sender: colIndexMap.sender !== undefined ? `Col ${colIndexMap.sender + 1}` : 'اختياري',
      beneficiary: colIndexMap.beneficiary !== undefined ? `Col ${colIndexMap.beneficiary + 1}` : 'اختياري',
    };

    const seenTxnIds = new Set<string>();
    let minDate: string | undefined;
    let maxDate: string | undefined;

    // Parse data rows starting after headerRowIndex
    for (let r = headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0 || row.every((c) => String(c).trim() === '')) {
        continue; // Skip blank rows
      }

      result.totalRows++;

      const rawTxnId = colIndexMap.transactionId !== undefined ? row[colIndexMap.transactionId] : row[1] || row[0];
      const rawAmount = colIndexMap.amount !== undefined ? row[colIndexMap.amount] : row[2];
      const rawDate = colIndexMap.date !== undefined ? row[colIndexMap.date] : row[0];
      const rawSender = colIndexMap.sender !== undefined ? row[colIndexMap.sender] : row[3];
      const rawBeneficiary = colIndexMap.beneficiary !== undefined ? row[colIndexMap.beneficiary] : row[4];
      const rawDescription = colIndexMap.description !== undefined ? row[colIndexMap.description] : row[5];

      const txnId = normalizeNumerals(String(rawTxnId || '')).trim();
      const amount = parseMonetaryAmount(rawAmount);
      const dateStr = normalizeDate(rawDate);
      const sender = String(rawSender || '').trim();
      const beneficiary = String(rawBeneficiary || '').trim();
      const desc = String(rawDescription || '').trim();

      // Validation
      if (!txnId || txnId.length < 3) {
        result.invalidRows.push({
          row: r + 1,
          reason: 'رقم العملية (Transaction ID) مفقود أو غير صالح',
          rawData: row,
        });
        continue;
      }

      if (amount <= 0) {
        result.invalidRows.push({
          row: r + 1,
          reason: 'مبلغ العملية يجب أن يكون رقماً موجباً أكبر من الصفر',
          rawData: row,
        });
        continue;
      }

      // Check intra-file duplicate
      const lowerTxn = txnId.toLowerCase();
      if (seenTxnIds.has(lowerTxn)) {
        result.duplicateTxnInFile.push(txnId);
      }
      seenTxnIds.add(lowerTxn);

      // Track date range
      if (!minDate || dateStr < minDate) minDate = dateStr;
      if (!maxDate || dateStr > maxDate) maxDate = dateStr;

      result.totalCreditAmount += amount;

      result.validLines.push({
        transactionId: txnId,
        amount,
        currency: 'SDG',
        transactionDate: dateStr,
        transactionTime: '12:00:00',
        senderName: sender || 'غير محدد',
        beneficiaryName: beneficiary || 'مكتب الصرافة',
        description: desc || `حركة بنكية واردة - ${txnId}`,
        rawRowIndex: r + 1,
      });
    }

    if (result.validLines.length === 0) {
      result.error = 'لم يتم العثور على أي حركات بنكية صالحة مستوفية للشروط في الملف المستورد';
      return result;
    }

    result.success = true;
    result.dateRange = { start: minDate, end: maxDate };
    return result;
  } catch (err: any) {
    result.error = `خطأ أثناء قراءة ملف كشف الحساب: ${err.message}`;
    return result;
  }
}
