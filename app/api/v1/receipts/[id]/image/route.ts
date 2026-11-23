import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { getReceiptSignedUrl } from '@/lib/storage/supabase-storage';
import fs from 'fs';
import path from 'path';

/**
 * Secure Authenticated Receipt Image Delivery Endpoint
 * Enforces RBAC permissions, generates short-lived signed URLs for private Supabase bucket,
 * and streams local private storage fallback files.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return authError('يرجى تسجيل الدخول لعرض صور إيصالات بنكك الحساسة', 401);
  }

  // RBAC Enforcement: Only authorized staff roles may view financial receipts
  const allowedRoles = ['admin', 'accountant', 'data_entry', 'bankak_auditor', 'custody_officer', 'viewer'];
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لرتبتك بعرض صور إيصالات بنكك', success: false },
      { status: 403 }
    );
  }

  const receipt = await prisma.bankakReceipt.findUnique({
    where: { id: params.id },
    select: { id: true, imageStorageKey: true, receiptNumber: true },
  });

  if (!receipt || !receipt.imageStorageKey || receipt.imageStorageKey === 'no-image') {
    return NextResponse.json(
      { error: 'صورة الإيصال غير متوفرة لهذا السجل', success: false },
      { status: 404 }
    );
  }

  // 1. If stored in Supabase private storage, generate fresh signed URL and redirect
  const signedUrl = await getReceiptSignedUrl(receipt.imageStorageKey, 3600);
  if (signedUrl && signedUrl.startsWith('http')) {
    return NextResponse.redirect(signedUrl, { status: 302 });
  }

  // 2. Check local private fallback storage (outside public/)
  let localFile = receipt.imageStorageKey.replace(/^local:/, '');
  if (localFile.startsWith('receipts/')) localFile = localFile.replace(/^receipts\//, '');
  
  const privateDir = path.join(process.cwd(), 'storage', 'receipts', localFile);
  const legacyPublicDir = path.join(process.cwd(), 'public', 'uploads', 'receipts', localFile);

  const targetPath = fs.existsSync(privateDir)
    ? privateDir
    : fs.existsSync(legacyPublicDir)
    ? legacyPublicDir
    : null;

  if (targetPath) {
    try {
      const buffer = await fs.promises.readFile(targetPath);
      const ext = path.extname(targetPath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `inline; filename="receipt-${receipt.receiptNumber}${ext}"`,
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      });
    } catch (e: any) {
      console.error('Error reading local receipt file:', e.message);
    }
  }

  return NextResponse.json(
    { error: 'ملف صورة الإيصال غير متوفر على وحدة التخزين', success: false },
    { status: 404 }
  );
}
