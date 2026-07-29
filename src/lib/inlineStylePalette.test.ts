import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from './settings';
import {
  applyInlineStylePalette,
  inlineStyleDefaultsForTone,
  normalizeInlineStyleColor,
  resetInlineStyleTone,
  resolveInlineStylePalette,
} from './inlineStylePalette';

describe('inline style palettes', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--skill-token-text-color');
    document.documentElement.style.removeProperty('--skill-token-background-color');
    document.documentElement.style.removeProperty('--inline-code-text-color');
    document.documentElement.style.removeProperty('--inline-code-background-color');
  });

  it('normalizes six-digit hex colors and rejects other CSS values', () => {
    expect(normalizeInlineStyleColor('#aabbcc', '#18181B')).toBe('#AABBCC');
    expect(normalizeInlineStyleColor('orange', '#18181B')).toBe('#18181B');
    expect(normalizeInlineStyleColor('#abc', '#18181B')).toBe('#18181B');
    expect(normalizeInlineStyleColor(null, '#18181B')).toBe('#18181B');
  });

  it('resolves the independently stored light and dark palettes', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      skillTokenLightTextColor: '#112233',
      skillTokenLightBackgroundColor: '#445566',
      skillTokenDarkTextColor: '#778899',
      skillTokenDarkBackgroundColor: '#AABBCC',
      inlineCodeLightTextColor: '#102030',
      inlineCodeLightBackgroundColor: '#405060',
      inlineCodeDarkTextColor: '#708090',
      inlineCodeDarkBackgroundColor: '#ABCDEF',
    };

    expect(resolveInlineStylePalette(settings, 'light')).toEqual({
      skillTokenTextColor: '#112233',
      skillTokenBackgroundColor: '#445566',
      inlineCodeTextColor: '#102030',
      inlineCodeBackgroundColor: '#405060',
    });
    expect(resolveInlineStylePalette(settings, 'dark')).toEqual({
      skillTokenTextColor: '#778899',
      skillTokenBackgroundColor: '#AABBCC',
      inlineCodeTextColor: '#708090',
      inlineCodeBackgroundColor: '#ABCDEF',
    });
  });

  it('resets only the requested tone', () => {
    const customized = {
      ...DEFAULT_SETTINGS,
      skillTokenLightTextColor: '#111111',
      skillTokenDarkTextColor: '#222222',
      inlineCodeLightBackgroundColor: '#333333',
      inlineCodeDarkBackgroundColor: '#444444',
    };

    const reset = resetInlineStyleTone(customized, 'dark');

    expect(reset).toMatchObject(inlineStyleDefaultsForTone('dark'));
    expect(reset.skillTokenLightTextColor).toBe('#111111');
    expect(reset.inlineCodeLightBackgroundColor).toBe('#333333');
  });

  it('writes one active palette to the shared root variables', () => {
    const palette = resolveInlineStylePalette(DEFAULT_SETTINGS, 'dark');

    applyInlineStylePalette(document.documentElement, palette);

    expect(
      document.documentElement.style.getPropertyValue('--skill-token-text-color'),
    ).toBe(palette.skillTokenTextColor);
    expect(
      document.documentElement.style.getPropertyValue('--skill-token-background-color'),
    ).toBe(palette.skillTokenBackgroundColor);
    expect(
      document.documentElement.style.getPropertyValue('--inline-code-text-color'),
    ).toBe(palette.inlineCodeTextColor);
    expect(
      document.documentElement.style.getPropertyValue('--inline-code-background-color'),
    ).toBe(palette.inlineCodeBackgroundColor);
  });
});
