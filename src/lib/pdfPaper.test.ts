import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PDF_PAPER,
  MAX_CUSTOM_PAPER_MM,
  MIN_CUSTOM_PAPER_MM,
  millimetersToPoints,
  normalizePdfPaper,
  resolvePdfPaper,
  swapCustomPaperDimensions,
  validateCustomPaperInput,
} from './pdfPaper';

describe('PDF paper geometry', () => {
  it.each([
    ['A4', 210, 297],
    ['A3', 297, 420],
    ['A2', 420, 594],
    ['Letter', 215.9, 279.4],
  ] as const)('resolves %s portrait and landscape', (paperSize, widthMm, heightMm) => {
    expect(resolvePdfPaper({ ...DEFAULT_PDF_PAPER, paperSize })).toMatchObject({
      widthMm,
      heightMm,
    });
    expect(
      resolvePdfPaper({
        ...DEFAULT_PDF_PAPER,
        paperSize,
        paperOrientation: 'landscape',
      }),
    ).toMatchObject({ widthMm: heightMm, heightMm: widthMm });
  });

  it('uses explicit Custom dimensions and swaps them', () => {
    const custom = {
      paperSize: 'Custom' as const,
      paperOrientation: 'portrait' as const,
      paperWidthMm: 180.5,
      paperHeightMm: 240.2,
    };
    expect(resolvePdfPaper(custom)).toMatchObject({ widthMm: 180.5, heightMm: 240.2 });
    expect(swapCustomPaperDimensions(custom)).toMatchObject({
      paperWidthMm: 240.2,
      paperHeightMm: 180.5,
    });
  });

  it('converts millimetres to WebKit points', () => {
    expect(millimetersToPoints(25.4)).toBeCloseTo(72, 8);
  });
});

describe('Custom paper validation', () => {
  it('accepts one-decimal values inside the supported range', () => {
    expect(validateCustomPaperInput('210.5')).toEqual({ valid: true, value: 210.5 });
  });

  it('rejects empty, over-precision, and out-of-range values', () => {
    expect(validateCustomPaperInput('')).toMatchObject({ valid: false });
    expect(validateCustomPaperInput('210.55')).toMatchObject({ valid: false });
    expect(validateCustomPaperInput(String(MIN_CUSTOM_PAPER_MM - 0.1))).toMatchObject({
      valid: false,
    });
    expect(validateCustomPaperInput(String(MAX_CUSTOM_PAPER_MM + 0.1))).toMatchObject({
      valid: false,
    });
  });

  it('migrates legacy and malformed paper values to safe defaults', () => {
    expect(normalizePdfPaper({ paperSize: 'Letter' })).toEqual({
      ...DEFAULT_PDF_PAPER,
      paperSize: 'Letter',
    });
    expect(normalizePdfPaper({ paperSize: 'Legal', paperWidthMm: Number.NaN })).toEqual(
      DEFAULT_PDF_PAPER,
    );
  });
});
