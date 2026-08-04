import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INLINE_CODE_PRESETS } from '@/lib/exportCodeStyles';
import { DEFAULT_EXPORT_STYLE } from '@/lib/exportDocument';
import { CODE_BLOCK_THEMES } from '@/lib/settings';

import { ExportCodeStyleControls } from './ExportCodeStyleControls';

describe('ExportCodeStyleControls', () => {
  afterEach(() => cleanup());

  it('offers Match app plus all fenced-code themes', () => {
    render(
      <ExportCodeStyleControls
        value={DEFAULT_EXPORT_STYLE}
        appCodeBlockTheme="one-dark"
        appTheme="dark"
        disabled={false}
        onChange={() => {}}
      />,
    );
    const select = screen.getByLabelText(
      'Code block theme',
    ) as HTMLSelectElement;
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      'app',
      ...CODE_BLOCK_THEMES.map((theme) => theme.value),
    ]);
    expect(select.options[0]?.textContent).toContain('One Dark');
  });

  it('exposes independent fenced-code typography ranges', () => {
    render(
      <ExportCodeStyleControls
        value={DEFAULT_EXPORT_STYLE}
        appCodeBlockTheme="one-dark"
        appTheme="light"
        disabled={false}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText('Code block size')).toHaveValue('12');
    expect(screen.getByLabelText('Code block size')).toHaveAttribute('min', '4');
    expect(screen.getByLabelText('Code block size')).toHaveAttribute('max', '24');
    expect(screen.getByLabelText('Code block size')).toHaveAttribute('step', '1');
    expect(screen.getByLabelText('Code block line height')).toHaveValue('1.6');
    expect(screen.getByLabelText('Code block line height')).toHaveAttribute('min', '0.8');
    expect(screen.getByLabelText('Code block line height')).toHaveAttribute('max', '2.2');
    expect(screen.getByLabelText('Code block line height')).toHaveAttribute('step', '0.1');
  });

  it('emits fenced-code typography patches and respects disabled state', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ExportCodeStyleControls
        value={DEFAULT_EXPORT_STYLE}
        appCodeBlockTheme="one-dark"
        appTheme="light"
        disabled={false}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Code block size'), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('Code block line height'), {
      target: { value: '0.9' },
    });
    expect(onChange).toHaveBeenNthCalledWith(1, { codeBlockFontSize: 4 });
    expect(onChange).toHaveBeenNthCalledWith(2, { codeBlockLineHeight: 0.9 });

    rerender(
      <ExportCodeStyleControls
        value={DEFAULT_EXPORT_STYLE}
        appCodeBlockTheme="one-dark"
        appTheme="light"
        disabled
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('Code block size')).toBeDisabled();
    expect(screen.getByLabelText('Code block line height')).toBeDisabled();
  });

  it('offers every approved inline preset and applies Blue', () => {
    const onChange = vi.fn();
    render(
      <ExportCodeStyleControls
        value={DEFAULT_EXPORT_STYLE}
        appCodeBlockTheme="one-dark"
        appTheme="light"
        disabled={false}
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText(
      'Inline code preset',
    ) as HTMLSelectElement;
    expect(Array.from(select.options, (option) => option.value)).toEqual(
      INLINE_CODE_PRESETS.map((preset) => preset.value),
    );
    fireEvent.change(select, { target: { value: 'blue' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        inlineCodePreset: 'blue',
        inlineCodeTextColor: '#1e3a8a',
        inlineCodeBackgroundColor: '#e8eefc',
      }),
    );
  });

  it('shows color pickers only for Custom', () => {
    const { rerender } = render(
      <ExportCodeStyleControls
        value={{ ...DEFAULT_EXPORT_STYLE, inlineCodePreset: 'blue' }}
        appCodeBlockTheme="one-dark"
        appTheme="light"
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Inline code text color')).toBeNull();
    rerender(
      <ExportCodeStyleControls
        value={{ ...DEFAULT_EXPORT_STYLE, inlineCodePreset: 'custom' }}
        appCodeBlockTheme="one-dark"
        appTheme="light"
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('Inline code text color')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Inline code background color'),
    ).toBeInTheDocument();
  });

  it('uses the resolved dark pair for a fixed inline preset', () => {
    const onChange = vi.fn();
    render(
      <ExportCodeStyleControls
        value={{ ...DEFAULT_EXPORT_STYLE, preset: 'dark' }}
        appCodeBlockTheme="one-dark"
        appTheme="light"
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Inline code preset'), {
      target: { value: 'rose' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        inlineCodePreset: 'rose',
        inlineCodeTextColor: '#fbcfe8',
        inlineCodeBackgroundColor: '#500724',
      }),
    );
  });
});
