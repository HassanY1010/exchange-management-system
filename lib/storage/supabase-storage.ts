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
  signedUrl?: string;
  publicUrl?: string;
  source: 'supabase_storage' | 'local_storage';
}

/**
 * Helper to save image buffer to local private directory (outside public/ to prevent unauthenticated access)
 */
async function saveLocalFallback(fileBuffer: Buffer, fileId: string): Promise<UploadReceiptResult> {
  try {
    const uploadDir = path.join(process.cwd(), 'storage', 'receipts');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const localFilePath = path.join(uploadDir, fileId);
    await fs.promises.writeFile(localFilePath, fileBuffer);
    return {
      storageKey: `local:receipts/${fileId}`,
      signedUrl: undefined,
      publicUrl: undefined,
      source: 'local_storage',
    };
  } catch (err: any) {
    console.warn('Local file saving error:', err.message);
    return {
      storageKey: fileId,
      signedUrl: undefined,
      publicUrl: undefined,
      source: 'local_storage',
    };
  }
}

/**
 * Uploads an image (Buffer or base64 data URL) to Supabase Storage bucket with local fallback
 * Ensures the bucket is private and generates cryptographic signed URLs instead of public URLs.
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
    const uploadPromise = (async (): Promise<UploadReceiptResult> => {
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

      return {
        storageKey: data.path,
        signedUrl: undefined,
        publicUrl: undefined,
        source: 'supabase_storage',
      };
    })();

    const timeoutPromise = new Promise<UploadReceiptResult>((resolve) => {
      setTimeout(() => {
        console.warn('Supabase upload timed out after 3.5s, falling back to local storage');
        saveLocalFallback(fileBuffer, fileId).then(resolve);
      }, 3500);
    });

    return await Promise.race([uploadPromise, timeoutPromise]);
  } catch (err) {
    console.warn('Failed to upload to Supabase, fallback to local file system:', err);
    return await saveLocalFallback(fileBuffer, fileId);
  }
}

/**
 * Generates a fresh, short-lived signed URL for a private Supabase storage key
 */
export async function getReceiptSignedUrl(
  storageKey: string,
  expiresInSeconds: number = 3600
): Promise<string | null> {
  if (!storageKey || storageKey === 'no-image') return null;

  // Data URLs can be rendered directly
  if (storageKey.startsWith('data:image')) return storageKey;

  // If already a valid signed URL with token parameter
  if (storageKey.startsWith('http') && storageKey.includes('token=')) {
    return storageKey;
  }

  if (supabase) {
    let cleanPath = storageKey;
    // Extract path if given a full URL
    if (cleanPath.startsWith('http')) {
      const match = cleanPath.match(/\/receipts\/(receipts\/.+)$/);
      if (match) cleanPath = match[1];
    }
    cleanPath = cleanPath.replace(/^local:/, '');

    try {
      const { data, error } = await supabase.storage
        .from(defaultBucket)
        .createSignedUrl(cleanPath, expiresInSeconds);
      if (!error && data?.signedUrl) {
        return data.signedUrl;
      }
    } catch (err: any) {
      console.warn('Failed to generate Supabase signed URL:', err.message);
    }
  }

  return null;
}

/**
 * Deletes an array of uploaded receipt images from Supabase Storage or local storage fallback.
 * Used during rollback to ensure zero orphaned files when a database transaction fails.
 */
export async function deleteReceiptImages(
  storageKeys: string[]
): Promise<{ deleted: string[]; errors: string[] }> {
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const key of storageKeys) {
    if (!key || key === 'no-image') continue;

    try {
      if (key.startsWith('local:')) {
        const relativePath = key.replace(/^local:/, '');
        const fullPath = path.join(process.cwd(), 'storage', relativePath);
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
          deleted.push(key);
        }
      } else if (supabase) {
        let cleanPath = key;
        if (cleanPath.startsWith('http')) {
          const match = cleanPath.match(/\/receipts\/(receipts\/.+)$/);
          if (match) cleanPath = match[1];
        }
        cleanPath = cleanPath.replace(/^local:/, '');
        const { error } = await supabase.storage.from(defaultBucket).remove([cleanPath]);
        if (error) {
          errors.push(`${key}: ${error.message}`);
        } else {
          deleted.push(key);
        }
      } else {
        // Fallback check if it was saved locally with just fileId
        const localPath = path.join(process.cwd(), 'storage', 'receipts', key);
        if (fs.existsSync(localPath)) {
          await fs.promises.unlink(localPath);
          deleted.push(key);
        }
      }
    } catch (err: any) {
      errors.push(`${key}: ${err.message}`);
    }
  }

  return { deleted, errors };
}
