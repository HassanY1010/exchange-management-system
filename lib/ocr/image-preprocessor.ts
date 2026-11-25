import sharp from 'sharp';

export interface ImageMetadataInfo {
  width: number;
  height: number;
  format?: string;
  orientation?: number;
  density?: number;
  isLowResolution: boolean;
  isOversized: boolean;
}

export interface PreprocessedImageResult {
  originalBuffer: Buffer;
  standardBuffer: Buffer;
  enhancedBuffer?: Buffer;
  metadata: ImageMetadataInfo;
  processedWidth: number;
  processedHeight: number;
  scaleFactor: number;
  preprocessingApplied: boolean;
  stepsApplied: string[];
  warning?: string;
}

export interface CropBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Inspects image dimensions and EXIF properties without modifying the original buffer.
 */
export async function inspectImageMetadata(buffer: Buffer): Promise<ImageMetadataInfo> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  return {
    width,
    height,
    format: meta.format,
    orientation: meta.orientation,
    density: meta.density,
    isLowResolution: width > 0 && width < 900,
    isOversized: width > 2400 || height > 3200,
  };
}

/**
 * Sharp-based Image Preprocessing Pipeline for Bankak Receipts:
 * - Preserves originalBuffer untouched
 * - Auto-orients via EXIF (.rotate())
 * - Upscales low-resolution screenshots/photos (Lanczos3) without inventing artifacts
 * - Downscales oversized camera photos to stay within production memory/CPU limits
 * - Converts to Grayscale, normalizes contrast, and applies gentle sharpening
 *   while preserving fine punctuation (dots, commas, zeros).
 */
export async function preprocessReceiptImage(
  originalBuffer: Buffer,
  options: { generateEnhanced?: boolean } = {}
): Promise<PreprocessedImageResult> {
  const stepsApplied: string[] = [];

  try {
    // Auto-orient first to get true post-EXIF dimensions
    const oriented = sharp(originalBuffer, { failOn: 'none' }).rotate();
    const { data: orientedBuf, info: orientedInfo } = await oriented.toBuffer({ resolveWithObject: true });

    const origWidth = orientedInfo.width || 0;
    const origHeight = orientedInfo.height || 0;

    if (origWidth === 0 || origHeight === 0) {
      throw new Error('أبعاد الصورة غير صالحة');
    }

    const rawMeta = await sharp(originalBuffer, { failOn: 'none' }).metadata();
    const metadata: ImageMetadataInfo = {
      width: origWidth,
      height: origHeight,
      format: rawMeta.format,
      orientation: rawMeta.orientation,
      density: rawMeta.density,
      isLowResolution: origWidth < 900,
      isOversized: origWidth > 2400 || origHeight > 3200,
    };

    if (rawMeta.orientation && rawMeta.orientation !== 1) {
      stepsApplied.push(`exif_rotate(${rawMeta.orientation})`);
    }

    // Calculate target width: upscale small images gently, cap huge camera photos
    let targetWidth = origWidth;
    let scaleFactor = 1;

    if (origWidth < 1000) {
      targetWidth = Math.min(1600, Math.round(origWidth * 1.6));
      scaleFactor = targetWidth / origWidth;
      stepsApplied.push(`upscale(${origWidth}->${targetWidth})`);
    } else if (origWidth > 2200 || origHeight > 3200) {
      const ratio = Math.min(2000 / origWidth, 3000 / origHeight);
      if (ratio < 1) {
        targetWidth = Math.round(origWidth * ratio);
        scaleFactor = targetWidth / origWidth;
        stepsApplied.push(`downscale(${origWidth}->${targetWidth})`);
      }
    }

    // Standard pipeline: Grayscale + Normalize contrast + gentle sharpen (preserves dots & commas)
    let stdPipeline = sharp(orientedBuf);
    if (targetWidth !== origWidth) {
      stdPipeline = stdPipeline.resize({
        width: targetWidth,
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: false,
      });
    }

    const { data: standardBuffer, info: stdInfo } = await stdPipeline
      .grayscale()
      .normalize()
      .sharpen({ sigma: 0.7, m1: 0.8, m2: 1.5 })
      .png({ compressionLevel: 6 })
      .toBuffer({ resolveWithObject: true });

    stepsApplied.push('grayscale', 'normalize', 'gentle_sharpen');

    let enhancedBuffer: Buffer | undefined;
    if (options.generateEnhanced) {
      let enhPipeline = sharp(orientedBuf);
      if (targetWidth !== origWidth) {
        enhPipeline = enhPipeline.resize({
          width: targetWidth,
          kernel: sharp.kernel.lanczos3,
          withoutEnlargement: false,
        });
      }
      enhancedBuffer = await enhPipeline
        .grayscale()
        .normalize()
        .linear(1.22, -16)
        .sharpen({ sigma: 1.0, m1: 1.0, m2: 2.0 })
        .png({ compressionLevel: 6 })
        .toBuffer();
      stepsApplied.push('enhanced_contrast');
    }

    return {
      originalBuffer,
      standardBuffer,
      enhancedBuffer,
      metadata,
      processedWidth: stdInfo.width || targetWidth,
      processedHeight: stdInfo.height || Math.round(origHeight * scaleFactor),
      scaleFactor,
      preprocessingApplied: true,
      stepsApplied,
    };
  } catch (err: any) {
    return {
      originalBuffer,
      standardBuffer: originalBuffer,
      metadata: {
        width: 0,
        height: 0,
        isLowResolution: false,
        isOversized: false,
      },
      processedWidth: 0,
      processedHeight: 0,
      scaleFactor: 1,
      preprocessingApplied: false,
      stepsApplied: ['fallback_raw_buffer'],
      warning: err?.message || 'تعذر تطبيق معالجة الصورة؛ تم استخدام النسخة الأصلية',
    };
  }
}

/**
 * Crops a Region of Interest (ROI) from a preprocessed image buffer with padding
 * and upscales it for high-precision single-line / single-block OCR verification.
 */
export async function cropRegionForOcr(
  imageBuffer: Buffer,
  bbox: CropBbox,
  imgWidth: number,
  imgHeight: number,
  paddingPx = 14,
  upscaleFactor = 2
): Promise<Buffer | null> {
  try {
    if (!imgWidth || !imgHeight) return null;

    const left = Math.max(0, Math.floor(bbox.x0 - paddingPx));
    const top = Math.max(0, Math.floor(bbox.y0 - paddingPx));
    const right = Math.min(imgWidth, Math.ceil(bbox.x1 + paddingPx));
    const bottom = Math.min(imgHeight, Math.ceil(bbox.y1 + paddingPx));

    const width = right - left;
    const height = bottom - top;
    if (width < 10 || height < 8) return null;

    const targetW = Math.min(1800, Math.round(width * upscaleFactor));

    return await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .resize({ width: targetW, kernel: sharp.kernel.lanczos3 })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 0.8 })
      .png({ compressionLevel: 4 })
      .toBuffer();
  } catch {
    return null;
  }
}
