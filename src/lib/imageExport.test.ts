import { describe, expect, it, vi } from 'vitest';

import { resolvePdfPaper } from './pdfPaper';
import {
  DEFAULT_IMAGE_EXPORT_OPTIONS,
  imageExtension,
  imageContinuousPixelSize,
  imageFormatLabel,
  imagePagePixelSize,
  loadImageExportOptions,
  saveImageExportPreferences,
  validateImageOutputSize,
} from './imageExport';

describe('image export options', () => {
  it('starts with PNG pages at 2× and quality 90', () => {
    expect(DEFAULT_IMAGE_EXPORT_OPTIONS).toEqual({
      format: 'png',
      layout: 'pages',
      scale: 2,
      quality: 90,
    });
  });

  it('restores preferences but always resets layout to Pages', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          format: 'webp',
          scale: 3,
          quality: 84,
          layout: 'long',
        }),
      setItem: vi.fn(),
    };

    expect(loadImageExportOptions(storage)).toEqual({
      format: 'webp',
      layout: 'pages',
      scale: 3,
      quality: 84,
    });
  });

  it('normalizes malformed storage and persists preferences without layout', () => {
    const setItem = vi.fn();
    const storage = {
      getItem: () => JSON.stringify({ format: 'gif', scale: 4, quality: 'high' }),
      setItem,
    };

    expect(loadImageExportOptions(storage)).toEqual(DEFAULT_IMAGE_EXPORT_OPTIONS);
    saveImageExportPreferences({ format: 'jpeg', layout: 'long', scale: 1, quality: 72 }, storage);
    expect(setItem).toHaveBeenCalledWith(
      'markdowner.imageExportOptions.v1',
      JSON.stringify({ format: 'jpeg', scale: 1, quality: 72 }),
    );
  });

  it('uses conventional labels and extensions', () => {
    expect(imageFormatLabel('png')).toBe('PNG');
    expect(imageFormatLabel('jpeg')).toBe('JPEG');
    expect(imageFormatLabel('webp')).toBe('WEBP');
    expect(imageExtension('png')).toBe('png');
    expect(imageExtension('jpeg')).toBe('jpg');
    expect(imageExtension('webp')).toBe('webp');
  });
});

describe('image export geometry', () => {
  it('converts resolved paper millimeters to deterministic 96 ppi pixels', () => {
    const paper = resolvePdfPaper({
      paperSize: 'A4',
      paperOrientation: 'portrait',
      paperWidthMm: 210,
      paperHeightMm: 297,
    });

    expect(imagePagePixelSize(paper, 1)).toEqual({ width: 794, height: 1123 });
    expect(imagePagePixelSize(paper, 2)).toEqual({ width: 1587, height: 2245 });
    expect(imagePagePixelSize(paper, 3)).toEqual({ width: 2381, height: 3368 });
    expect(
      imageContinuousPixelSize(paper, 2, {
        width: 595.2755905511812,
        height: 1_420.5,
      }),
    ).toEqual({ width: 1587, height: 3787 });
  });

  it('rejects invalid dimensions and page counts', () => {
    expect(
      validateImageOutputSize({
        format: 'png',
        layout: 'pages',
        width: 0,
        height: 100,
        pages: 1,
      }),
    ).toEqual({
      valid: false,
      message: 'Image dimensions must be positive whole pixels.',
    });
    expect(
      validateImageOutputSize({
        format: 'png',
        layout: 'pages',
        width: 100,
        height: 100,
        pages: 101,
      }),
    ).toEqual({
      valid: false,
      message: 'Image export supports 1 to 100 pages.',
    });
  });

  it('enforces long-image and codec limits with actionable errors', () => {
    expect(
      validateImageOutputSize({
        format: 'png',
        layout: 'long',
        width: 10_001,
        height: 10_000,
        pages: 1,
      }),
    ).toEqual({
      valid: false,
      message: 'Long images cannot exceed 100,000,000 pixels. Lower the scale or use Pages.',
    });
    expect(
      validateImageOutputSize({
        format: 'webp',
        width: 16_384,
        height: 200,
        pages: 1,
      }),
    ).toEqual({
      valid: false,
      message:
        'WebP images cannot exceed 16383 pixels on either side. Lower the scale or use Pages.',
    });
    expect(
      validateImageOutputSize({
        format: 'jpeg',
        layout: 'long',
        width: 200,
        height: 65_536,
        pages: 1,
      }),
    ).toEqual({
      valid: false,
      message:
        'JPEG images cannot exceed 65535 pixels on either side. Lower the scale or use Pages.',
    });
  });

  it('accepts valid paged and continuous output geometry', () => {
    expect(
      validateImageOutputSize({
        format: 'png',
        layout: 'pages',
        width: 2_381,
        height: 3_368,
        pages: 100,
      }),
    ).toEqual({ valid: true });
    expect(
      validateImageOutputSize({
        format: 'webp',
        layout: 'long',
        width: 2_000,
        height: 10_000,
        pages: 1,
      }),
    ).toEqual({ valid: true });
  });
});
