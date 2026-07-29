import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INLINE_STYLE_COLOR_DEFAULTS } from '@/lib/inlineStylePalette';
import { DEFAULT_SETTINGS } from '@/lib/settings';

import { InlineStyleColorSettings } from './InlineStyleColorSettings';

describe('InlineStyleColorSettings', () => {
  afterEach(cleanup);

  it('opens on the effective tone and previews its stored colors', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      skillTokenDarkTextColor: '#112233',
      skillTokenDarkBackgroundColor: '#445566',
      inlineCodeDarkTextColor: '#778899',
      inlineCodeDarkBackgroundColor: '#AABBCC',
    };

    render(
      <InlineStyleColorSettings
        settings={settings}
        onSettingsChange={vi.fn()}
        defaultTone="dark"
      />,
    );

    expect(screen.getByTestId('inline-style-color-settings')).toHaveAttribute(
      'data-tone',
      'dark',
    );
    expect(screen.getByLabelText('Skill Token Dark Text')).toHaveValue('#112233');
    expect(screen.getByLabelText('Inline Code Dark Background')).toHaveValue(
      '#aabbcc',
    );
    expect(screen.getByTestId('skill-token-color-preview')).toHaveStyle({
      color: '#112233',
      backgroundColor: '#445566',
    });
    expect(screen.getByTestId('inline-code-color-preview')).toHaveStyle({
      color: '#778899',
      backgroundColor: '#AABBCC',
    });
  });

  it('edits the selected light palette without changing dark values', () => {
    const onSettingsChange = vi.fn();

    render(
      <InlineStyleColorSettings
        settings={DEFAULT_SETTINGS}
        onSettingsChange={onSettingsChange}
        defaultTone="dark"
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Light palette' }));
    fireEvent.change(screen.getByLabelText('Inline Code Light Background'), {
      target: { value: '#123456' },
    });

    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      inlineCodeLightBackgroundColor: '#123456',
    });
  });

  it('resets only one card in the selected tone', () => {
    const onSettingsChange = vi.fn();
    const settings = {
      ...DEFAULT_SETTINGS,
      skillTokenLightTextColor: '#111111',
      skillTokenLightBackgroundColor: '#222222',
      inlineCodeLightTextColor: '#333333',
      inlineCodeLightBackgroundColor: '#444444',
    };

    render(
      <InlineStyleColorSettings
        settings={settings}
        onSettingsChange={onSettingsChange}
        defaultTone="light"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Reset Skill Token Light colors' }),
    );

    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      skillTokenLightTextColor:
        INLINE_STYLE_COLOR_DEFAULTS.skillTokenLightTextColor,
      skillTokenLightBackgroundColor:
        INLINE_STYLE_COLOR_DEFAULTS.skillTokenLightBackgroundColor,
    });
  });
});
