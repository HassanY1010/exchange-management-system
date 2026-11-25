import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { normalizeDigits, stripUnicodeBidi } from '../lib/ocr/number-normalizer';
import { parseBankakAmount } from '../lib/ocr/amount-parser';
import {
  parseBankakReceiptText,
  isCleanArabicName,
  evaluateArabicNameCompleteness,
  OcrPageData,
} from '../lib/ocr/bankak-parser';
import { preprocessReceiptImage } from '../lib/ocr/image-preprocessor';
import { processReceiptImageWithOcr, shouldAdoptRoiAmount } from '../lib/ocr/image-ocr';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ [PASS] ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    console.error(`  ❌ [FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function runOcrRegressionSuite() {
  console.log('========================================================================');
  console.log('  OCR & Amount Recognition Comprehensive Regression Suite');
  console.log('========================================================================\n');

  // 1. Number Normalization Tests
  console.log('--- 1. Number & Unicode Normalization Tests ---');
  assert(
    normalizeDigits('\u200F٢٬٥٠٠٬٠٠٠\u200E') === '2,500,000',
    'Eastern Arabic digits + Arabic thousands separator + Bidi chars'
  );
  assert(
    normalizeDigits('۲٬۵۰۰٬۰۰۰') === '2,500,000',
    'Persian digits (۰-۹) + Arabic thousands separator'
  );
  assert(
    normalizeDigits('2\u00A0500\u202F000٫50') === '2 500 000.50',
    'Non-breaking spaces (NBSP / NNBSP) + Arabic decimal separator (٫)'
  );
  assert(
    stripUnicodeBidi('\u202A12345\u202C') === '12345',
    'Strip invisible Unicode directional embedding chars'
  );

  // 2. Amount Parser Tests (All 15 Required Formats + Ambiguity)
  console.log('\n--- 2. Financial Amount Parser Tests (parseBankakAmount) ---');
  const amountCases: Array<{ input: string; expected: number; label: string }> = [
    { input: '2,500,000', expected: 2500000, label: 'Standard comma thousands (2,500,000)' },
    { input: '5,000,000', expected: 5000000, label: '5,000,000' },
    { input: '20,000,000', expected: 20000000, label: '20,000,000' },
    { input: '220', expected: 220, label: 'Small integer (220)' },
    { input: '2,500', expected: 2500, label: 'Comma thousands (2,500)' },
    { input: '2.500.000', expected: 2500000, label: 'Multi-dot thousands (2.500.000)' },
    { input: '2,500,000.00', expected: 2500000, label: 'Standard with .00 decimals (2,500,000.00)' },
    { input: '1.943,000.00', expected: 1943000, label: 'Tesseract mixed dot/comma (1.943,000.00)' },
    { input: '٢٬٥٠٠٬٠٠٠', expected: 2500000, label: 'Eastern Arabic + Arabic thousands (٢٬٥٠٠٬٠٠٠)' },
    { input: '٢,٥٠٠,٠٠٠', expected: 2500000, label: 'Eastern Arabic + ASCII comma (٢,٥٠٠,٠٠٠)' },
    { input: '۲٬۵۰۰٬۰۰۰', expected: 2500000, label: 'Persian digits + Arabic thousands (۲٬۵۰۰٬۰۰۰)' },
    { input: '2500000', expected: 2500000, label: 'Plain unformatted integer (2500000)' },
    { input: '2 500 000', expected: 2500000, label: 'Space-separated thousands (2 500 000)' },
    { input: '2\u00A0500\u00A0000', expected: 2500000, label: 'NBSP-separated thousands (2\u00A0500\u00A0000)' },
    { input: "2'500'000", expected: 2500000, label: "Apostrophe-separated thousands (2'500'000)" },
  ];

  for (const tc of amountCases) {
    const res = parseBankakAmount(tc.input);
    assert(
      res.success && !res.isAmbiguous && res.value === tc.expected,
      tc.label,
      `got ${res.value} (${res.separatorInterpretation})`
    );
  }

  // Ambiguous format must NOT invent a value
  const ambig = parseBankakAmount('2.500');
  assert(
    !ambig.success && ambig.isAmbiguous && ambig.value === 0,
    'Ambiguous single-dot 3-digit format (2.500) flagged without inventing value',
    ambig.ambiguityReason
  );

  // 3. Region / BBox & Confidence Scoring Tests
  console.log('\n--- 3. Region/BBox Extraction & Honest Confidence Tests ---');
  const mockPageLowConf: OcrPageData = {
    text: 'رقم العملية 20188179228\nالمبلغ 220\nإسم المرسل اليه ابوالقاسم عثمان\nمن حساب 1039202520143\n16-Nov-2026',
    confidence: 42,
    lines: [
      {
        text: 'المبلغ 220',
        confidence: 38,
        bbox: { x0: 50, y0: 400, x1: 400, y1: 440 },
        words: [
          { text: 'المبلغ', confidence: 85, bbox: { x0: 300, y0: 400, x1: 400, y1: 440 } },
          { text: '220', confidence: 38, bbox: { x0: 50, y0: 400, x1: 120, y1: 440 } },
        ],
      },
    ],
  };
  const parsedLow = parseBankakReceiptText(mockPageLowConf.text, mockPageLowConf);
  assert(
    parsedLow.ocrConfidence < 80 && parsedLow.tesseractConfidence === 42 && (parsedLow.ocrWarnings?.length || 0) > 0,
    'Low Tesseract word/page confidence prevents misleading 100% score',
    `ocrConfidence=${parsedLow.ocrConfidence}%, tesseract=${parsedLow.tesseractConfidence}%`
  );

  // 3B. Targeted Regression Tests for the 3 Fixed OCR Edge Cases
  const primary500k = parseBankakReceiptText('رقم العملية 20325685916\nالمبلغ 500,000.00\n17-Nov-2026');
  const roiNoise7 = parseBankakAmount('7');
  const roiNoisePage: OcrPageData = { text: '7 لمباخ 3', confidence: 82, lines: [] };
  assert(
    !shouldAdoptRoiAmount(primary500k, roiNoise7, roiNoisePage),
    'ROI guard prevents replacing valid 500,000 with stray single-digit 7 from adjacent line'
  );

  const labelTypoPrevLine = parseBankakReceiptText(
    'رقم العملية 20425682427\nالتاريخ 17-Nov-2026\nالتعليق\nN/A\n4,500,000.00\n| المبلخ'
  );
  assert(
    labelTypoPrevLine.amount === 4500000 && labelTypoPrevLine.amountValid === true,
    'Extracts amount 4,500,000 from previous line when OCR reads المبلغ as المبلخ',
    `got ${labelTypoPrevLine.amount}`
  );

  const labelTypoSameLinePrev = parseBankakReceiptText(
    'رقم العملية 21440267046\nالتاريخ 17-Nov-2026\n5,000,000.00 | المبلع'
  );
  assert(
    labelTypoSameLinePrev.amount === 5000000 && labelTypoSameLinePrev.amountValid === true,
    'Extracts amount 5,000,000 preceding OCR typo label المبلع on same line',
    `got ${labelTypoSameLinePrev.amount}`
  );

  // 3C. Beneficiary Name Cleaning & Preservation Regression Tests
  const cleanCase1 = parseBankakReceiptText('سم المرسك >< عوض ابراهيم اسحاق هارون');
  assert(
    cleanCase1.receiverName === 'عوض ابراهيم اسحاق هارون' && isCleanArabicName(cleanCase1.receiverName),
    'Strips garbled label prefix "سم المرسك ><" while preserving full Arabic name',
    `got "${cleanCase1.receiverName}"`
  );

  const cleanCase2 = parseBankakReceiptText('إسم المرسل إليه عوض Glow! prolyl هارون');
  assert(
    cleanCase2.receiverName === 'عوض هارون' && isCleanArabicName(cleanCase2.receiverName),
    'Strips stray Latin/punctuation artifacts inside Arabic name',
    `got "${cleanCase2.receiverName}"`
  );

  const cleanCase3 = parseBankakReceiptText('إسم المرسل إليه الطيب عبد المتعال محجوب الحسن');
  assert(
    cleanCase3.receiverName === 'الطيب عبد المتعال محجوب الحسن' &&
      cleanCase3.receiverNameQuality === 'full' &&
      !cleanCase3.receiverNameNeedsReview,
    'Preserves 5-part Arabic beneficiary name completely intact as full',
    `got "${cleanCase3.receiverName}"`
  );

  const partialEval = evaluateArabicNameCompleteness('عوض هارون');
  assert(
    partialEval.isClean && partialEval.quality === 'partial' && partialEval.wordCount === 2,
    'Distinguishes 2-word partial Arabic name from full 3+ word name',
    `quality=${partialEval.quality}, words=${partialEval.wordCount}`
  );

  // 4. Image Preprocessing Pipeline Tests (Sharp)
  console.log('\n--- 4. Sharp Image Preprocessing Pipeline Tests ---');
  const fixturePath = path.join(process.cwd(), 'scripts', 'fixtures', 'receipt1.jpg');
  if (fs.existsSync(fixturePath)) {
    const origBuf = fs.readFileSync(fixturePath);
    const prep = await preprocessReceiptImage(origBuf, { generateEnhanced: true });
    assert(
      prep.preprocessingApplied &&
        prep.standardBuffer.length > 0 &&
        Boolean(prep.enhancedBuffer) &&
        prep.originalBuffer === origBuf,
      'Sharp preprocessing produces standard & enhanced buffers without mutating original',
      `steps=${prep.stepsApplied.join(',')}, ${prep.metadata.width}x${prep.metadata.height} -> ${prep.processedWidth}x${prep.processedHeight}`
    );

    // Test degraded / rotated / low-contrast image variant created dynamically via Sharp
    const degradedBuf = await sharp(origBuf)
      .resize({ width: 550 }) // simulate WhatsApp / compressed low-res
      .modulate({ brightness: 0.85 })
      .jpeg({ quality: 55 })
      .toBuffer();

    const degradedOcr = await processReceiptImageWithOcr(degradedBuf);
    assert(
      degradedOcr.engineUsed === 'tesseract' &&
        degradedOcr.parsed.amount === 1943000 &&
        degradedOcr.parsed.transactionId === '20425437680',
      'Degraded/compressed WhatsApp-like receipt1.jpg extracts exact amount 1,943,000 & TXN ID',
      `amount=${degradedOcr.parsed.amount}, txn=${degradedOcr.parsed.transactionId}, conf=${degradedOcr.parsed.ocrConfidence}%`
    );
  }

  // 5. Real Fixture Images Regression (All fixtures in scripts/fixtures & scripts/prod-fixtures)
  console.log('\n--- 5. Real Bankak Receipt Images Regression ---');
  const realExpectations: Array<{ dir: string; file: string; expectedAmount: number; expectedTxn: string }> = [
    { dir: 'scripts/fixtures', file: 'receipt1.jpg', expectedAmount: 1943000, expectedTxn: '20425437680' },
    { dir: 'scripts/fixtures', file: 'receipt2.jpg', expectedAmount: 5000000, expectedTxn: '20038176728' },
    { dir: 'scripts/fixtures', file: 'receipt3.jpg', expectedAmount: 1000000, expectedTxn: '20188179228' },
    { dir: 'scripts/fixtures', file: 'receipt4.jpg', expectedAmount: 1800000, expectedTxn: '20026330498' },
    { dir: 'scripts/prod-fixtures', file: 'prod_receipt_20038176728.png', expectedAmount: 5000000, expectedTxn: '20038176728' },
  ];

  for (const item of realExpectations) {
    const fullPath = path.join(process.cwd(), item.dir, item.file);
    if (!fs.existsSync(fullPath)) continue;
    const buf = fs.readFileSync(fullPath);
    const res = await processReceiptImageWithOcr(buf);
    assert(
      res.engineUsed === 'tesseract' &&
        res.parsed.amount === item.expectedAmount &&
        res.parsed.transactionId === item.expectedTxn,
      `Real image ${item.file}`,
      `amount=${res.parsed.amount} (exp ${item.expectedAmount}), txn=${res.parsed.transactionId}, conf=${res.parsed.ocrConfidence}%, tess=${res.diagnostics?.tesseractConfidence}%, ms=${res.durationMs}`
    );
  }

  console.log('\n========================================================================');
  console.log(`  Regression Summary: ${passed} passed, ${failed} failed`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runOcrRegressionSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Regression suite crashed:', err);
    process.exit(1);
  });
