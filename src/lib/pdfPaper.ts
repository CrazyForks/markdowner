export type PdfPaperPreset = 'A4' | 'A3' | 'A2' | 'Letter' | 'Custom';
export type PdfPaperOrientation = 'portrait' | 'landscape';

export interface PdfPaper {
  paperSize: PdfPaperPreset;
  paperOrientation: PdfPaperOrientation;
  paperWidthMm: number;
  paperHeightMm: number;
}

export interface ResolvedPdfPaper extends PdfPaper {
  widthMm: number;
  heightMm: number;
  widthPt: number;
  heightPt: number;
}

export const MIN_CUSTOM_PAPER_MM = 25.4;
export const MAX_CUSTOM_PAPER_MM = 2000;
export const MAX_PDF_PAGES = 100;

export const DEFAULT_PDF_PAPER: PdfPaper = {
  paperSize: 'A4',
  paperOrientation: 'portrait',
  paperWidthMm: 210,
  paperHeightMm: 297,
};

const PRESET_DIMENSIONS_MM: Record<
  Exclude<PdfPaperPreset, 'Custom'>,
  readonly [number, number]
> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  Letter: [215.9, 279.4],
};

export function millimetersToPoints(value: number): number {
  return (value * 72) / 25.4;
}

function normalizedCustomDimension(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.round(number * 10) / 10;
  return rounded >= MIN_CUSTOM_PAPER_MM && rounded <= MAX_CUSTOM_PAPER_MM
    ? rounded
    : fallback;
}

export function normalizePdfPaper(value: unknown): PdfPaper {
  const candidate =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const paperSize =
    candidate.paperSize === 'A4' ||
    candidate.paperSize === 'A3' ||
    candidate.paperSize === 'A2' ||
    candidate.paperSize === 'Letter' ||
    candidate.paperSize === 'Custom'
      ? candidate.paperSize
      : DEFAULT_PDF_PAPER.paperSize;
  const paperOrientation =
    candidate.paperOrientation === 'landscape' ? 'landscape' : 'portrait';
  return {
    paperSize,
    paperOrientation,
    paperWidthMm: normalizedCustomDimension(
      candidate.paperWidthMm,
      DEFAULT_PDF_PAPER.paperWidthMm,
    ),
    paperHeightMm: normalizedCustomDimension(
      candidate.paperHeightMm,
      DEFAULT_PDF_PAPER.paperHeightMm,
    ),
  };
}

export function resolvePdfPaper(value: PdfPaper): ResolvedPdfPaper {
  const paper = normalizePdfPaper(value);
  let widthMm = paper.paperWidthMm;
  let heightMm = paper.paperHeightMm;
  if (paper.paperSize !== 'Custom') {
    [widthMm, heightMm] = PRESET_DIMENSIONS_MM[paper.paperSize];
    if (paper.paperOrientation === 'landscape') {
      [widthMm, heightMm] = [heightMm, widthMm];
    }
  }
  return {
    ...paper,
    widthMm,
    heightMm,
    widthPt: millimetersToPoints(widthMm),
    heightPt: millimetersToPoints(heightMm),
  };
}

export function swapCustomPaperDimensions(value: PdfPaper): PdfPaper {
  const paper = normalizePdfPaper(value);
  return {
    ...paper,
    paperWidthMm: paper.paperHeightMm,
    paperHeightMm: paper.paperWidthMm,
  };
}

export type CustomPaperInputResult =
  | { valid: true; value: number }
  | { valid: false; message: string };

export function validateCustomPaperInput(value: string): CustomPaperInputResult {
  if (!/^\d+(?:\.\d)?$/.test(value)) {
    return { valid: false, message: 'Enter a value with at most one decimal place.' };
  }
  const number = Number(value);
  if (number < MIN_CUSTOM_PAPER_MM || number > MAX_CUSTOM_PAPER_MM) {
    return {
      valid: false,
      message: `Use ${MIN_CUSTOM_PAPER_MM}–${MAX_CUSTOM_PAPER_MM} mm.`,
    };
  }
  return { valid: true, value: number };
}
