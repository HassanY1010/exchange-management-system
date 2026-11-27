import crypto from 'crypto';
import { computeImageHash, ParsedBankakReceipt } from './bankak-parser';

export interface OcrPreviewTokenPayload {
  imageHash: string;
  userId: string;
  customerId: string;
  parsed: ParsedBankakReceipt;
  rawText: string;
  iat: number;
  exp: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getSigningSecret(): string {
  const secret = process.env.OCR_PREVIEW_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error('Server OCR preview signing secret is not configured in environment variables');
  }
  return secret;
}

function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

/**
 * Signs server-extracted OCR results with HMAC-SHA256, binding them to:
 * - Original image SHA-256 hash
 * - Authenticated userId
 * - Target customerId
 * - Issued-at and expiration timestamps
 */
export function signOcrPreviewToken(params: {
  imageHash: string;
  userId: string;
  customerId: string;
  parsed: ParsedBankakReceipt;
  rawText: string;
  ttlMs?: number;
  nowMs?: number;
}): string {
  const secret = getSigningSecret();
  const now = params.nowMs ?? Date.now();
  const payload: OcrPreviewTokenPayload = {
    imageHash: params.imageHash,
    userId: params.userId,
    customerId: params.customerId,
    parsed: params.parsed,
    rawText: params.rawText,
    iat: now,
    exp: now + (params.ttlMs ?? DEFAULT_TTL_MS),
  };

  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const sigB64 = toBase64Url(signature);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies an HMAC-SHA256 OCR preview token using timing-safe comparison,
 * enforcing expiration, userId, customerId, and live image SHA-256 hash match.
 */
export function verifyOcrPreviewToken(
  token: string,
  expected: {
    imageData: Buffer | string;
    userId: string;
    customerId: string;
    nowMs?: number;
  }
): OcrPreviewTokenPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('رمز معاينة الـ OCR مفقود أو غير صالح');
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('تنسيق رمز معاينة الـ OCR غير صالح');
  }

  const [payloadB64, sigB64] = parts;
  const secret = getSigningSecret();

  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const actualSig = fromBase64Url(sigB64);

  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
    throw new Error('توقيع رمز معاينة الـ OCR غير صالح أو تم التلاعب به');
  }

  let payload: OcrPreviewTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64).toString('utf8'));
  } catch {
    throw new Error('تعذر قراءة بيانات رمز معاينة الـ OCR');
  }

  const now = expected.nowMs ?? Date.now();
  if (!payload.exp || typeof payload.exp !== 'number' || now > payload.exp) {
    throw new Error('انتهت صلاحية رمز معاينة الـ OCR، يرجى إعادة فحص الصور');
  }

  if (payload.userId !== expected.userId) {
    throw new Error('رمز معاينة الـ OCR غير مصرح به لهذا المستخدم');
  }

  if (payload.customerId !== expected.customerId) {
    throw new Error('رمز معاينة الـ OCR لا يطابق العميل المحدد');
  }

  const actualImageHash = computeImageHash(expected.imageData);
  if (!payload.imageHash || payload.imageHash !== actualImageHash) {
    throw new Error('صورة الإيصال المرسلة لا تطابق بصمة الصورة التي تمت معاينتها');
  }

  if (!payload.parsed || typeof payload.parsed !== 'object') {
    throw new Error('بيانات OCR الموقعة غير مكتملة');
  }

  return payload;
}
