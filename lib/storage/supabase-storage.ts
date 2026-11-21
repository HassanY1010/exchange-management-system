import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const defaultBucket = process.env.SUPABASE_BUCKET_NAME || 'receipts';

/**
 * Initializes Supabase Client (if environment variables are present)
 */
export const supabase = (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id'))
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      realtime: { transport: ws as any },
    })
  : null;

export interface UploadReceiptResult {
  storageKey: string;
  publicUrl?: string;
  source: 'supabase_storage' | 'local_storage';
}

/**
 * Helper to save image buffer to local public directory so Next.js can serve it
 */
async function saveLocalFallback(fileBuffer: Buffer, fileId: string): Promise<UploadReceiptResult> {
  try {
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'receipts');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const localFilePath = path.join(uploadDir, fileId);
    await fs.promises.writeFile(localFilePath, fileBuffer);
    return {
      storageKey: `receipts/${fileId}`,
      publicUrl: `/uploads/receipts/${fileId}`,
      source: 'local_storage',
    };
  } catch (err: any) {
    console.warn('Local file saving error:', err.message);
    return {
      storageKey: fileId,
      publicUrl: undefined,
      source: 'local_storage',
    };
  }
}

/**
 * Uploads an image (Buffer or base64 data URL) to Supabase Storage bucket with local fallback
 */
export async function uploadReceiptImage(
  imageBufferOrBase64: Buffer | string,
  filename?: string
): Promise<UploadReceiptResult> {
  const fileId = filename || `receipt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;

  let fileBuffer: Buffer;
  let contentType = 'image/png';

  if (typeof imageBufferOrBase64 === 'string') {
    if (imageBufferOrBase64.startsWith('data:image')) {
      const matches = imageBufferOrBase64.match(/^data:(image\/[a-zA-Z0-9\-\+\.]+);base64,(.+)$/);
      if (matches) {
        contentType = matches[1];
        fileBuffer = Buffer.from(matches[2], 'base64');
      } else {
        fileBuffer = Buffer.from(imageBufferOrBase64, 'base64');
      }
    } else {
      fileBuffer = Buffer.from(imageBufferOrBase64);
    }
  } else {
    fileBuffer = imageBufferOrBase64;
  }

  // If Supabase is not configured or in local mode, store locally
  if (!supabase) {
    return await saveLocalFallback(fileBuffer, fileId);
  }

  try {
    const { data, error } = await supabase.storage
      .from(defaultBucket)
      .upload(`receipts/${fileId}`, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.warn('Supabase storage upload warning (falling back to local):', error.message);
      return await saveLocalFallback(fileBuffer, fileId);
    }

    const { data: publicUrlData } = supabase.storage
      .from(defaultBucket)
      .getPublicUrl(data.path);

    // Also write local copy for high-speed local preview and redundancy
    saveLocalFallback(fileBuffer, fileId).catch(() => {});

    return {
      storageKey: data.path,
      publicUrl: publicUrlData?.publicUrl || `/uploads/receipts/${fileId}`,
      source: 'supabase_storage',
    };
  } catch (err) {
    console.warn('Failed to upload to Supabase, fallback to local file system:', err);
    return await saveLocalFallback(fileBuffer, fileId);
  }
}
