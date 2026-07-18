import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EXPORT_PAGE_LAYOUT } from '@/lib/exportPageLayout';

import { ContentPaddingControls } from './ContentPaddingControls';

describe('ContentPaddingControls', () => {
  afterEach(() => cleanup());

  it('starts in All sides and emits four equal values', () => {
    const onChange = vi.fn();
    render(
      <ContentPaddingControls
        value={DEFAULT_EXPORT_PAGE_LAYOUT}
        disabled={false}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'All sides' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(screen.getByLabelText('All sides padding'), {
      target: { value: '40' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentPaddingMode: 'all',
        contentPaddingTop: 40,
        contentPaddingRight: 40,
        contentPaddingBottom: 40,
        contentPaddingLeft: 40,
      }),
    );
  });

  it('shows Top Right Bottom Left in Per side mode and preserves values', () => {
    const onChange = vi.fn();
    render(
      <ContentPaddingControls
        value={{
          ...DEFAULT_EXPORT_PAGE_LAYOUT,
          contentPaddingMode: 'individual',
          contentPaddingTop: 10,
          contentPaddingRight: 20,
          contentPaddingBottom: 30,
          contentPaddingLeft: 40,
        }}
        disabled={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('Top padding')).toHaveValue('10');
    expect(screen.getByLabelText('Right padding')).toHaveValue('20');
    expect(screen.getByLabelText('Bottom padding')).toHaveValue('30');
    expect(screen.getByLabelText('Left padding')).toHaveValue('40');
  });

  it('copies Top to every side when switching back to All sides', () => {
    const onChange = vi.fn();
    render(
      <ContentPaddingControls
        value={{
          ...DEFAULT_EXPORT_PAGE_LAYOUT,
          contentPaddingMode: 'individual',
          contentPaddingTop: 10,
          contentPaddingRight: 20,
          contentPaddingBottom: 30,
          contentPaddingLeft: 40,
        }}
        disabled={false}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'All sides' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentPaddingMode: 'all',
        contentPaddingTop: 10,
        contentPaddingRight: 10,
        contentPaddingBottom: 10,
        contentPaddingLeft: 10,
      }),
    );
  });
});
