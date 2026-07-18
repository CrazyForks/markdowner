import { describe, expect, it } from 'vitest';

import {
  INLINE_CODE_PRESETS,
  inferInlineCodePreset,
  normalizeExportCodeBlockTheme,
  resolveExportTone,
  resolveInlineCodePalette,
} from './exportCodeStyles';

describe('export code styles', () => {
  it('offers the approved extended preset catalog', () => {
    expect(INLINE_CODE_PRESETS.map((entry) => entry.value)).toEqual([
      'theme',
      'neutral',
      'amber',
      'blue',
      'green',
      'rose',
      'contrast',
      'custom',
    ]);
  });

  it.each(['neutral', 'amber', 'blue', 'green', 'rose', 'contrast'] as const)(
    'returns readable light and dark variants for %s',
    (preset) => {
      expect(resolveInlineCodePalette(preset, 'light')).not.toEqual(
        resolveInlineCodePalette(preset, 'dark'),
      );
    },
  );

  it('derives Match export theme from the resolved export colors', () => {
    expect(
      resolveInlineCodePalette('theme', 'light', {
        textColor: '#202124',
        surfaceColor: '#f4f4f5',
      }),
    ).toEqual({ textColor: '#202124', backgroundColor: '#f4f4f5' });
  });

  it('infers Amber from legacy defaults and Custom from unknown valid colors', () => {
    expect(inferInlineCodePreset('#7c2d12', '#ffedd5')).toBe('amber');
    expect(inferInlineCodePreset('#123456', '#abcdef')).toBe('custom');
  });

  it('validates fixed and Match app code themes', () => {
    expect(normalizeExportCodeBlockTheme('app')).toBe('app');
    expect(normalizeExportCodeBlockTheme('github-light')).toBe('github-light');
    expect(normalizeExportCodeBlockTheme('unknown')).toBe('app');
  });

  it('uses background luminance for a Custom export palette', () => {
    expect(resolveExportTone('custom', '#fafafa', 'dark')).toBe('light');
    expect(resolveExportTone('custom', '#111827', 'light')).toBe('dark');
  });
});
