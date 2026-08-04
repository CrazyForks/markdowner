import { MAX_PDF_PAGES, type ResolvedPdfPaper } from './pdfPaper';

export type ImageExportFormat = 'png' | 'jpeg' | 'webp';
export type ImageExportLayout = 'pages' | 'long';
export type ImageExportScale = 1 | 2 | 3;

export interface ImageExportOptions {
  format: ImageExportFormat;
  layout: ImageExportLayout;
  scale: ImageExportScale;
  quality: number;
}

export interface ImageOutputSize {
  format: ImageExportFormat;
  layout?: ImageExportLayout;
  width: number;
  height: number;
  pages: number;
}

export type ImageOutputSizeValidation = { valid: true } | { valid: false; message: string };

export const DEFAULT_IMAGE_EXPORT_OPTIONS: ImageExportOptions = {
  format: 'png',
  layout: 'pages',
  scale: 2,
  quality: 90,
};

export const CSS_PIXELS_PER_INCH = 96;
export const MAX_LONG_IMAGE_PIXELS = 100_000_000;
export const MAX_WEBP_AXIS_PIXELS = 16_383;
export const MAX_JPEG_AXIS_PIXELS = 65_535;
export const MAX_PNG_AXIS_PIXELS = 2_147_483_647;

const IMAGE_EXPORT_OPTIONS_STORAGE_KEY = 'markdowner.imageExportOptions.v1';

type ImageOptionsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function imageOptionsStorage(storage?: ImageOptionsStorage): ImageOptionsStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeImageExportOptions(value: unknown): ImageExportOptions {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const format =
    candidate.format === 'png' || candidate.format === 'jpeg' || candidate.format === 'webp'
      ? candidate.format
      : DEFAULT_IMAGE_EXPORT_OPTIONS.format;
  const layout = candidate.layout === 'long' ? 'long' : 'pages';
  const scale =
    candidate.scale === 1 || candidate.scale === 2 || candidate.scale === 3
      ? candidate.scale
      : DEFAULT_IMAGE_EXPORT_OPTIONS.scale;
  const numericQuality =
    typeof candidate.quality === 'number' ? candidate.quality : Number(candidate.quality);
  const quality = Number.isFinite(numericQuality)
    ? Math.min(100, Math.max(1, Math.round(numericQuality)))
    : DEFAULT_IMAGE_EXPORT_OPTIONS.quality;

  return { format, layout, scale, quality };
}

export function loadImageExportOptions(storage?: ImageOptionsStorage): ImageExportOptions {
  const target = imageOptionsStorage(storage);
  if (!target) return { ...DEFAULT_IMAGE_EXPORT_OPTIONS };
  try {
    const stored = target.getItem(IMAGE_EXPORT_OPTIONS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_IMAGE_EXPORT_OPTIONS };
    return {
      ...normalizeImageExportOptions(JSON.parse(stored)),
      layout: 'pages',
    };
  } catch {
    return { ...DEFAULT_IMAGE_EXPORT_OPTIONS };
  }
}

export function saveImageExportPreferences(
  options: ImageExportOptions,
  storage?: ImageOptionsStorage,
): void {
  const target = imageOptionsStorage(storage);
  if (!target) return;
  const normalized = normalizeImageExportOptions(options);
  try {
    target.setItem(
      IMAGE_EXPORT_OPTIONS_STORAGE_KEY,
      JSON.stringify({
        format: normalized.format,
        scale: normalized.scale,
        quality: normalized.quality,
      }),
    );
  } catch {
    // Export preferences are optional and must never block an export.
  }
}

export function imageExtension(format: ImageExportFormat): 'png' | 'jpg' | 'webp' {
  if (format === 'jpeg') return 'jpg';
  return format;
}

export function imageFormatLabel(format: ImageExportFormat): 'PNG' | 'JPEG' | 'WEBP' {
  if (format === 'jpeg') return 'JPEG';
  return format.toUpperCase() as 'PNG' | 'WEBP';
}

export function imagePagePixelSize(
  paper: ResolvedPdfPaper,
  scale: ImageExportScale,
): { width: number; height: number } {
  return {
    width: Math.round((paper.widthMm / 25.4) * CSS_PIXELS_PER_INCH * scale),
    height: Math.round((paper.heightMm / 25.4) * CSS_PIXELS_PER_INCH * scale),
  };
}

export function imageContinuousPixelSize(
  paper: ResolvedPdfPaper,
  scale: ImageExportScale,
  measured: { width: number; height: number },
): { width: number; height: number } {
  const pageSize = imagePagePixelSize(paper, scale);
  return {
    width: pageSize.width,
    height: Math.round((measured.height / measured.width) * pageSize.width),
  };
}

export function validateImageOutputSize(input: ImageOutputSize): ImageOutputSizeValidation {
  if (
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    return {
      valid: false,
      message: 'Image dimensions must be positive whole pixels.',
    };
  }
  if (!Number.isInteger(input.pages) || input.pages < 1 || input.pages > MAX_PDF_PAGES) {
    return {
      valid: false,
      message: `Image export supports 1 to ${MAX_PDF_PAGES} pages.`,
    };
  }

  const axisLimit =
    input.format === 'webp'
      ? MAX_WEBP_AXIS_PIXELS
      : input.format === 'jpeg'
        ? MAX_JPEG_AXIS_PIXELS
        : MAX_PNG_AXIS_PIXELS;
  if (input.width > axisLimit || input.height > axisLimit) {
    const codecName = input.format === 'webp' ? 'WebP' : imageFormatLabel(input.format);
    return {
      valid: false,
      message: `${codecName} images cannot exceed ${axisLimit} pixels on either side. Lower the scale or use Pages.`,
    };
  }

  const layout = input.layout ?? 'long';
  if (layout === 'long' && input.width * input.height > MAX_LONG_IMAGE_PIXELS) {
    return {
      valid: false,
      message: 'Long images cannot exceed 100,000,000 pixels. Lower the scale or use Pages.',
    };
  }

  return { valid: true };
}
