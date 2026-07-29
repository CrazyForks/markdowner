import type { Settings } from './settings';
import type { ThemeKind } from './desktop';

export type InlineStyleTone = 'light' | 'dark';

export type InlineStylePalette = {
  skillTokenTextColor: string;
  skillTokenBackgroundColor: string;
  inlineCodeTextColor: string;
  inlineCodeBackgroundColor: string;
};

export const INLINE_STYLE_COLOR_DEFAULTS = {
  skillTokenLightTextColor: '#18181B',
  skillTokenLightBackgroundColor: '#F4F4F5',
  skillTokenDarkTextColor: '#FAFAFA',
  skillTokenDarkBackgroundColor: '#27272A',
  inlineCodeLightTextColor: '#18181B',
  inlineCodeLightBackgroundColor: '#F4F4F5',
  inlineCodeDarkTextColor: '#FAFAFA',
  inlineCodeDarkBackgroundColor: '#27272A',
} as const;

export type InlineStyleColorSettings = {
  [Key in keyof typeof INLINE_STYLE_COLOR_DEFAULTS]: string;
};

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

export function resolveInlineStyleTone(
  themeKind: ThemeKind,
  systemThemeKind: Exclude<ThemeKind, 'CustomCss'>,
): InlineStyleTone {
  const resolvedThemeKind =
    themeKind === 'CustomCss' ? systemThemeKind : themeKind;
  return resolvedThemeKind === 'BuiltInDark' ? 'dark' : 'light';
}

export function normalizeInlineStyleColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value)
    ? value.toUpperCase()
    : fallback;
}

export function inlineStyleDefaultsForTone(
  tone: InlineStyleTone,
): Partial<InlineStyleColorSettings> {
  return tone === 'light'
    ? {
        skillTokenLightTextColor:
          INLINE_STYLE_COLOR_DEFAULTS.skillTokenLightTextColor,
        skillTokenLightBackgroundColor:
          INLINE_STYLE_COLOR_DEFAULTS.skillTokenLightBackgroundColor,
        inlineCodeLightTextColor:
          INLINE_STYLE_COLOR_DEFAULTS.inlineCodeLightTextColor,
        inlineCodeLightBackgroundColor:
          INLINE_STYLE_COLOR_DEFAULTS.inlineCodeLightBackgroundColor,
      }
    : {
        skillTokenDarkTextColor:
          INLINE_STYLE_COLOR_DEFAULTS.skillTokenDarkTextColor,
        skillTokenDarkBackgroundColor:
          INLINE_STYLE_COLOR_DEFAULTS.skillTokenDarkBackgroundColor,
        inlineCodeDarkTextColor:
          INLINE_STYLE_COLOR_DEFAULTS.inlineCodeDarkTextColor,
        inlineCodeDarkBackgroundColor:
          INLINE_STYLE_COLOR_DEFAULTS.inlineCodeDarkBackgroundColor,
      };
}

export function resetInlineStyleTone(
  settings: Settings,
  tone: InlineStyleTone,
): Settings {
  return {
    ...settings,
    ...inlineStyleDefaultsForTone(tone),
  };
}

export function resolveInlineStylePalette(
  settings: InlineStyleColorSettings,
  tone: InlineStyleTone,
): InlineStylePalette {
  return tone === 'light'
    ? {
        skillTokenTextColor: settings.skillTokenLightTextColor,
        skillTokenBackgroundColor: settings.skillTokenLightBackgroundColor,
        inlineCodeTextColor: settings.inlineCodeLightTextColor,
        inlineCodeBackgroundColor: settings.inlineCodeLightBackgroundColor,
      }
    : {
        skillTokenTextColor: settings.skillTokenDarkTextColor,
        skillTokenBackgroundColor: settings.skillTokenDarkBackgroundColor,
        inlineCodeTextColor: settings.inlineCodeDarkTextColor,
        inlineCodeBackgroundColor: settings.inlineCodeDarkBackgroundColor,
      };
}

export function applyInlineStylePalette(
  root: HTMLElement,
  palette: InlineStylePalette,
): void {
  root.style.setProperty('--skill-token-text-color', palette.skillTokenTextColor);
  root.style.setProperty(
    '--skill-token-background-color',
    palette.skillTokenBackgroundColor,
  );
  root.style.setProperty('--inline-code-text-color', palette.inlineCodeTextColor);
  root.style.setProperty(
    '--inline-code-background-color',
    palette.inlineCodeBackgroundColor,
  );
}
