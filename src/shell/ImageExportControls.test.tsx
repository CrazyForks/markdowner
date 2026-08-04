import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_IMAGE_EXPORT_OPTIONS } from '@/lib/imageExport';
import { ImageExportControls } from './ImageExportControls';

describe('ImageExportControls', () => {
  afterEach(() => cleanup());

  it('shows the approved PNG, Pages, and 2× defaults without lossy quality', () => {
    render(
      <ImageExportControls
        value={DEFAULT_IMAGE_EXPORT_OPTIONS}
        disabled={false}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Image format' })).toHaveValue('png');
    expect(screen.getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('slider', { name: 'Image quality' })).toBeNull();
  });

  it('emits complete normalized options and reveals quality for lossy formats', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ImageExportControls
        value={DEFAULT_IMAGE_EXPORT_OPTIONS}
        disabled={false}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Image format' }), {
      target: { value: 'jpeg' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_IMAGE_EXPORT_OPTIONS,
      format: 'jpeg',
    });

    rerender(
      <ImageExportControls
        value={{ ...DEFAULT_IMAGE_EXPORT_OPTIONS, format: 'jpeg' }}
        disabled={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Image quality' })).toHaveValue('90');
    fireEvent.change(screen.getByRole('slider', { name: 'Image quality' }), {
      target: { value: '73' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_IMAGE_EXPORT_OPTIONS,
      format: 'jpeg',
      quality: 73,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Long image' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_IMAGE_EXPORT_OPTIONS,
      format: 'jpeg',
      layout: 'long',
    });
    fireEvent.click(screen.getByRole('button', { name: '3×' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_IMAGE_EXPORT_OPTIONS,
      format: 'jpeg',
      scale: 3,
    });
  });
});
