import { CODE_BLOCK_THEMES, type CodeBlockTheme } from './settings';

export type ExportCodeBlockTheme = 'app' | CodeBlockTheme;
export type InlineCodePreset =
  | 'theme'
  | 'neutral'
  | 'amber'
  | 'blue'
  | 'green'
  | 'rose'
  | 'contrast'
  | 'custom';
export type ExportTone = 'light' | 'dark';

export interface InlineCodePalette {
  textColor: string;
  backgroundColor: string;
}

export interface ExportThemeColors {
  textColor: string;
  surfaceColor: string;
}

export const INLINE_CODE_PRESETS = [
  { value: 'theme', label: 'Match export theme' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'amber', label: 'Amber' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'rose', label: 'Rose' },
  { value: 'contrast', label: 'Contrast' },
  { value: 'custom', label: 'Custom' },
] as const satisfies ReadonlyArray<{ value: InlineCodePreset; label: string }>;

const INLINE_CODE_PALETTES: Record<
  Exclude<InlineCodePreset, 'theme' | 'custom'>,
  Record<ExportTone, InlineCodePalette>
> = {
  neutral: {
    light: { textColor: '#37352f', backgroundColor: '#f1f1ef' },
    dark: { textColor: '#f4f4f5', backgroundColor: '#2f2f32' },
  },
  amber: {
    light: { textColor: '#7c2d12', backgroundColor: '#ffedd5' },
    dark: { textColor: '#fed7aa', backgroundColor: '#431407' },
  },
  blue: {
    light: { textColor: '#1e3a8a', backgroundColor: '#e8eefc' },
    dark: { textColor: '#bfdbfe', backgroundColor: '#172554' },
  },
  green: {
    light: { textColor: '#166534', backgroundColor: '#dcfce7' },
    dark: { textColor: '#bbf7d0', backgroundColor: '#052e16' },
  },
  rose: {
    light: { textColor: '#9d174d', backgroundColor: '#fce7f3' },
    dark: { textColor: '#fbcfe8', backgroundColor: '#500724' },
  },
  contrast: {
    light: { textColor: '#f9fafb', backgroundColor: '#111827' },
    dark: { textColor: '#111827', backgroundColor: '#f9fafb' },
  },
};

const INLINE_CODE_PRESET_VALUES = new Set<InlineCodePreset>(
  INLINE_CODE_PRESETS.map((preset) => preset.value),
);
const CODE_BLOCK_THEME_VALUES = new Set<CodeBlockTheme>(
  CODE_BLOCK_THEMES.map((theme) => theme.value),
);

export function normalizeExportCodeBlockTheme(
  value: unknown,
): ExportCodeBlockTheme {
  return value === 'app' || CODE_BLOCK_THEME_VALUES.has(value as CodeBlockTheme)
    ? (value as ExportCodeBlockTheme)
    : 'app';
}

export function normalizeInlineCodePreset(
  value: unknown,
  fallback: InlineCodePreset,
): InlineCodePreset {
  return INLINE_CODE_PRESET_VALUES.has(value as InlineCodePreset)
    ? (value as InlineCodePreset)
    : fallback;
}

export function resolveInlineCodePalette(
  preset: InlineCodePreset,
  tone: ExportTone,
  themeColors?: ExportThemeColors,
): InlineCodePalette {
  if (preset === 'theme') {
    return {
      textColor: themeColors?.textColor ?? INLINE_CODE_PALETTES.neutral[tone].textColor,
      backgroundColor:
        themeColors?.surfaceColor ?? INLINE_CODE_PALETTES.neutral[tone].backgroundColor,
    };
  }
  if (preset === 'custom') {
    return {
      textColor: themeColors?.textColor ?? INLINE_CODE_PALETTES.amber[tone].textColor,
      backgroundColor:
        themeColors?.surfaceColor ?? INLINE_CODE_PALETTES.amber[tone].backgroundColor,
    };
  }
  return { ...INLINE_CODE_PALETTES[preset][tone] };
}

export function inferInlineCodePreset(
  textColor: string,
  backgroundColor: string,
): InlineCodePreset {
  const normalizedText = textColor.toLowerCase();
  const normalizedBackground = backgroundColor.toLowerCase();
  for (const preset of Object.keys(INLINE_CODE_PALETTES) as Array<
    keyof typeof INLINE_CODE_PALETTES
  >) {
    for (const tone of ['light', 'dark'] as const) {
      const palette = INLINE_CODE_PALETTES[preset][tone];
      if (
        palette.textColor === normalizedText &&
        palette.backgroundColor === normalizedBackground
      ) {
        return preset;
      }
    }
  }
  return 'custom';
}

function backgroundTone(backgroundColor: string, fallback: ExportTone): ExportTone {
  const match = /^#([0-9a-f]{6})$/i.exec(backgroundColor);
  if (!match) return fallback;
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance >= 0.45 ? 'light' : 'dark';
}

export function resolveExportTone(
  preset: 'app' | 'light' | 'dark' | 'custom',
  backgroundColor: string,
  appTone: ExportTone,
): ExportTone {
  if (preset === 'light' || preset === 'dark') return preset;
  if (preset === 'app') return appTone;
  return backgroundTone(backgroundColor, appTone);
}
