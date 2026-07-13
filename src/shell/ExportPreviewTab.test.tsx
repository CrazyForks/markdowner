import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EXPORT_STYLE, type ExportHtmlOptions } from '@/lib/exportDocument';
import { ExportPreviewTab, type ExportPreviewRequest } from './ExportPreviewTab';

const HTML_REQUEST: ExportPreviewRequest = {
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
    const inlineCodeColor = options.style?.inlineCodeTextColor ?? '';
    return `<!doctype html><style>font-size:${size}px;color:${inlineCodeColor}</style><h1>Notes</h1>`;
  });
}

function renderPreview(overrides: Partial<ComponentProps<typeof ExportPreviewTab>> = {}) {
  return render(
    <ExportPreviewTab
      request={HTML_REQUEST}
      initialStyle={DEFAULT_EXPORT_STYLE}
      busy={false}
      onCancel={() => {}}
      onConfirm={() => {}}
      buildPreview={previewBuilder()}
      {...overrides}
    />,
  );
}

describe('ExportPreviewTab', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses the full editor surface and the Export Preview name', () => {
    renderPreview();

    expect(screen.getByRole('heading', { name: 'Export Preview' })).toBeInTheDocument();
    expect(screen.getByTestId('export-preview-surface')).toHaveClass('flex-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('edits the body size in the live preview and confirms the draft style', async () => {
    const onConfirm = vi.fn();
    renderPreview({ onConfirm });

    fireEvent.change(screen.getByLabelText('Body size'), { target: { value: '13' } });

    await waitFor(() => {
      expect(screen.getByTitle('HTML export preview')).toHaveAttribute(
        'srcdoc',
        expect.stringContaining('font-size:13px'),
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 13 }));
  });

  it('exposes typography, spacing, inline code, and keyboard-key controls', () => {
    renderPreview();

    expect(screen.getByLabelText('Body size')).toHaveValue('14');
    expect(screen.getByLabelText('Font family')).toHaveValue('sans');
    expect(screen.getByLabelText('Text color')).toHaveValue('#202124');
    expect(screen.getByLabelText('Background color')).toHaveValue('#ffffff');
    expect(screen.getByLabelText('Line height')).toHaveValue('1.6');
    expect(screen.getByLabelText('Line height')).toHaveAttribute('min', '0.8');
    expect(screen.getByLabelText('Line height')).toHaveAttribute('max', '2.2');
    expect(screen.getByLabelText('Paragraph spacing')).toHaveValue('8');
    expect(screen.getByLabelText('Content padding')).toHaveValue('32');
    expect(screen.getByLabelText('Inline code text color')).toHaveValue('#7c2d12');
    expect(screen.getByLabelText('Inline code background color')).toHaveValue('#ffedd5');
    expect(screen.getByLabelText('Keyboard key text color')).toHaveValue('#334155');
    expect(screen.getByLabelText('Keyboard key background color')).toHaveValue('#e2e8f0');
  });

  it('updates inline-code color in the live preview', async () => {
    renderPreview();

    fireEvent.change(screen.getByLabelText('Inline code text color'), {
      target: { value: '#314158' },
    });

    await waitFor(() => {
      expect(screen.getByTitle('HTML export preview')).toHaveAttribute(
        'srcdoc',
        expect.stringContaining('color:#314158'),
      );
    });
  });

  it('shows paper size for PDF only and resets changed values', () => {
    const commonProps = {
      initialStyle: DEFAULT_EXPORT_STYLE,
      busy: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      buildPreview: previewBuilder(),
    };
    const { rerender } = render(<ExportPreviewTab {...commonProps} request={HTML_REQUEST} />);
    expect(screen.queryByLabelText('Paper size')).toBeNull();

    rerender(
      <ExportPreviewTab
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
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = renderPreview({ onCancel, onConfirm });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <ExportPreviewTab
        request={HTML_REQUEST}
        initialStyle={DEFAULT_EXPORT_STYLE}
        busy
        onCancel={onCancel}
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
    renderPreview({
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
    renderPreview({ request: { ...HTML_REQUEST, scope: 'workspace', targetCount: 3 } });

    expect(screen.getByText('3 Markdown files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export 3 HTML files' })).toBeInTheDocument();
  });
});
