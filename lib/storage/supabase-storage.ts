import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

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
 * Uploads an image (Buffer or base64 data URL) to Supabase Storage bucket
 */
export async function uploadReceiptImage(
  imageBufferOrBase64: Buffer | string,
  filename?: string
): Promise<UploadReceiptResult> {
  const fileId = filename || `receipt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;

  // Fallback if Supabase is not configured yet
  if (!supabase) {
    const previewKey = typeof imageBufferOrBase64 === 'string'
      ? (imageBufferOrBase64.length > 500 ? imageBufferOrBase64.substring(0, 500) : imageBufferOrBase64)
      : `buffer-${fileId}`;

    return {
      storageKey: previewKey,
      source: 'local_storage',
    };
  }

  try {
    let fileBuffer: Buffer;
    let contentType = 'image/png';

    if (typeof imageBufferOrBase64 === 'string') {
      if (imageBufferOrBase64.startsWith('data:image')) {
        const matches = imageBufferOrBase64.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
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

    const { data, error } = await supabase.storage
      .from(defaultBucket)
      .upload(`receipts/${fileId}`, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.warn('Supabase storage upload warning (falling back):', error.message);
      return {
        storageKey: fileId,
        source: 'local_storage',
      };
    }

    const { data: publicUrlData } = supabase.storage
      .from(defaultBucket)
      .getPublicUrl(data.path);

    return {
      storageKey: data.path,
      publicUrl: publicUrlData.publicUrl,
      source: 'supabase_storage',
    };
  } catch (err) {
    console.warn('Failed to upload to Supabase, fallback to local reference:', err);
    return {
      storageKey: fileId,
      source: 'local_storage',
    };
  }
}
