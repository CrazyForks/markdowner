import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  INLINE_STYLE_COLOR_DEFAULTS,
  normalizeInlineStyleColor,
  resolveInlineStylePalette,
  type InlineStyleTone,
} from '@/lib/inlineStylePalette';
import type { Settings } from '@/lib/settings';

import { ExportColorControl } from './ExportControlPrimitives';

interface InlineStyleColorSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  defaultTone: InlineStyleTone;
}

type InlineColorKey =
  | 'skillTokenLightTextColor'
  | 'skillTokenLightBackgroundColor'
  | 'skillTokenDarkTextColor'
  | 'skillTokenDarkBackgroundColor'
  | 'inlineCodeLightTextColor'
  | 'inlineCodeLightBackgroundColor'
  | 'inlineCodeDarkTextColor'
  | 'inlineCodeDarkBackgroundColor';

type StyleKind = 'skillToken' | 'inlineCode';

function colorKeys(
  tone: InlineStyleTone,
  kind: StyleKind,
): { text: InlineColorKey; background: InlineColorKey } {
  if (kind === 'skillToken') {
    return tone === 'light'
      ? {
          text: 'skillTokenLightTextColor',
          background: 'skillTokenLightBackgroundColor',
        }
      : {
          text: 'skillTokenDarkTextColor',
          background: 'skillTokenDarkBackgroundColor',
        };
  }
  return tone === 'light'
    ? {
        text: 'inlineCodeLightTextColor',
        background: 'inlineCodeLightBackgroundColor',
      }
    : {
        text: 'inlineCodeDarkTextColor',
        background: 'inlineCodeDarkBackgroundColor',
      };
}

export function InlineStyleColorSettings({
  settings,
  onSettingsChange,
  defaultTone,
}: InlineStyleColorSettingsProps) {
  const [tone, setTone] = useState<InlineStyleTone>(defaultTone);

  useEffect(() => {
    setTone(defaultTone);
  }, [defaultTone]);

  const palette = resolveInlineStylePalette(settings, tone);

  const updateColor = (key: InlineColorKey, value: string) => {
    onSettingsChange({
      ...settings,
      [key]: normalizeInlineStyleColor(value, settings[key]),
    });
  };

  const resetCard = (kind: StyleKind) => {
    const keys = colorKeys(tone, kind);
    onSettingsChange({
      ...settings,
      [keys.text]: INLINE_STYLE_COLOR_DEFAULTS[keys.text],
      [keys.background]: INLINE_STYLE_COLOR_DEFAULTS[keys.background],
    });
  };

  const renderCard = (
    kind: StyleKind,
    title: string,
    preview: React.ReactNode,
  ) => {
    const keys = colorKeys(tone, kind);
    const toneLabel = tone === 'light' ? 'Light' : 'Dark';

    return (
      <article className="grid min-w-0 gap-3 rounded-xl border border-border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <h5 className="text-sm font-medium">{title}</h5>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Reset ${title} ${toneLabel} colors`}
            onClick={() => resetCard(kind)}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ExportColorControl
            id={`inline-style-${kind}-${tone}-text`}
            label={`${title} ${toneLabel} Text`}
            value={settings[keys.text]}
            disabled={false}
            onChange={(value) => updateColor(keys.text, value)}
          />
          <ExportColorControl
            id={`inline-style-${kind}-${tone}-background`}
            label={`${title} ${toneLabel} Background`}
            value={settings[keys.background]}
            disabled={false}
            onChange={(value) => updateColor(keys.background, value)}
          />
        </div>
        <div className="flex min-h-12 items-center rounded-lg border border-border bg-background px-3 py-2">
          {preview}
        </div>
      </article>
    );
  };

  return (
    <div
      data-testid="inline-style-color-settings"
      data-tone={tone}
      className="grid min-w-0 gap-3 rounded-xl border border-border bg-background/60 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h4 className="text-sm font-medium">Inline Style Colors</h4>
          <p className="text-xs text-muted-foreground">
            Customize editor and preview colors independently for each theme.
          </p>
        </div>
        <ToggleGroup
          type="single"
          value={tone}
          onValueChange={(value) => {
            if (value === 'light' || value === 'dark') setTone(value);
          }}
          variant="outline"
          size="sm"
          aria-label="Inline style palette tone"
          className="shrink-0"
        >
          <ToggleGroupItem value="light" aria-label="Light palette">
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" aria-label="Dark palette">
            Dark
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {renderCard(
          'skillToken',
          'Skill Token',
          <span
            data-testid="skill-token-color-preview"
            className="rounded px-1.5 py-0.5 font-mono text-xs"
            style={{
              color: palette.skillTokenTextColor,
              backgroundColor: palette.skillTokenBackgroundColor,
            }}
          >
            /goal · $git-commit
          </span>,
        )}
        {renderCard(
          'inlineCode',
          'Inline Code',
          <code
            data-testid="inline-code-color-preview"
            className="rounded px-1.5 py-0.5 font-mono text-xs"
            style={{
              color: palette.inlineCodeTextColor,
              backgroundColor: palette.inlineCodeBackgroundColor,
            }}
          >
            const value = 42
          </code>,
        )}
      </div>
    </div>
  );
}
