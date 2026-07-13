import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EXPORT_STYLE, type ExportHtmlOptions } from '@/lib/exportDocument';
import { ExportDialog, type ExportDialogRequest } from './ExportDialog';

const HTML_REQUEST: ExportDialogRequest = {
  format: 'html',
  scope: 'document',
  title: 'notes',
  source: '# Notes',
  activeDocumentPath: '/tmp/notes.md',
  targetCount: 1,
};

function previewBuilder() {
  return vi.fn(async (options: ExportHtmlOptions) => {
    const size = options.style?.fontSize ?? DEFAULT_EXPORT_STYLE.fontSize;
    return `<!doctype html><style>font-size:${size}px</style><h1>Notes</h1>`;
  });
}

function renderDialog(overrides: Partial<ComponentProps<typeof ExportDialog>> = {}) {
  return render(
    <ExportDialog
      open
      request={HTML_REQUEST}
      initialStyle={DEFAULT_EXPORT_STYLE}
      busy={false}
      onOpenChange={() => {}}
      onConfirm={() => {}}
      buildPreview={previewBuilder()}
      {...overrides}
    />,
  );
}

describe('ExportDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('edits the body size in the live preview and confirms the draft style', async () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });

    fireEvent.change(screen.getByLabelText('Body size'), { target: { value: '13' } });

    await waitFor(() => {
      expect(screen.getByTitle('HTML export preview')).toHaveAttribute(
        'srcdoc',
        expect.stringContaining('font-size:13px'),
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: 13 }),
    );
  });

  it('exposes every requested appearance control with readable values', () => {
    renderDialog();

    expect(screen.getByLabelText('Body size')).toHaveValue('14');
    expect(screen.getByLabelText('Font family')).toHaveValue('sans');
    expect(screen.getByLabelText('Text color')).toHaveValue('#202124');
    expect(screen.getByLabelText('Background color')).toHaveValue('#ffffff');
    expect(screen.getByLabelText('Line height')).toHaveValue('1.6');
    expect(screen.getByLabelText('Paragraph spacing')).toHaveValue('8');
    expect(screen.getByLabelText('Content padding')).toHaveValue('32');
  });

  it('shows paper size for PDF only and resets changed values', () => {
    const buildPreview = previewBuilder();
    const commonProps = {
      open: true,
      initialStyle: DEFAULT_EXPORT_STYLE,
      busy: false,
      onOpenChange: vi.fn(),
      onConfirm: vi.fn(),
      buildPreview,
    };
    const { rerender } = render(
      <ExportDialog {...commonProps} request={HTML_REQUEST} />,
    );
    expect(screen.queryByLabelText('Paper size')).toBeNull();

    rerender(
      <ExportDialog
        {...commonProps}
        request={{ ...HTML_REQUEST, format: 'pdf' }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Body size'), { target: { value: '20' } });
    expect(screen.getByLabelText('Paper size')).toHaveValue('A4');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Body size')).toHaveValue('14');
  });

  it('cancels without confirming and locks actions while exporting', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = renderDialog({ onOpenChange, onConfirm });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <ExportDialog
        open
        request={HTML_REQUEST}
        initialStyle={DEFAULT_EXPORT_STYLE}
        busy
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        buildPreview={previewBuilder()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Body size')).toBeDisabled();
  });

  it('reports a preview failure without confirming an export', async () => {
    const onConfirm = vi.fn();
    renderDialog({
      onConfirm,
      buildPreview: vi.fn(async () => {
        throw new Error('image failed');
      }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Preview unavailable');
    expect(screen.getByRole('button', { name: 'Export HTML' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('describes and confirms workspace batch size', () => {
    renderDialog({
      request: { ...HTML_REQUEST, scope: 'workspace', targetCount: 3 },
    });

    expect(screen.getByText('3 Markdown files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export 3 HTML files' })).toBeInTheDocument();
  });
});
