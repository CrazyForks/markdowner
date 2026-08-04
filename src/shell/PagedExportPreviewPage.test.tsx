import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PDF_PREVIEW_READY_MESSAGE } from '@/lib/pdfPagination';
import { PagedExportPreviewPage } from './PagedExportPreviewPage';

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 500,
    bottom: top + height,
    left: 0,
    width: 500,
    height,
    toJSON: () => ({}),
  };
}

function renderPage(formatLabel: 'PDF' | 'Image' = 'Image') {
  const onReady = vi.fn();
  const onError = vi.fn();
  render(
    <PagedExportPreviewPage
      formatLabel={formatLabel}
      html="<!doctype html><html><body>Preview</body></html>"
      token="preview-7"
      pageIndex={1}
      width={595.2755905511812}
      height={841.8897637795276}
      pageInsets={{ top: 32, right: 36, bottom: 40, left: 44 }}
      pageFurniture={{
        headerText: 'Project Atlas',
        headerAlignment: 'left',
        footerText: '',
        footerAlignment: 'center',
        pageNumbersEnabled: true,
        pageNumberPosition: 'bottom-center',
        pageNumberTemplate: '{page}/{pages}',
        textColor: '#202124',
        fontFamily: 'system-ui, sans-serif',
      }}
      backgroundColor="#ffffff"
      onReady={onReady}
      onError={onError}
    />,
  );
  const frame = screen.getByTitle(`${formatLabel} preview page 2`) as HTMLIFrameElement;
  Object.defineProperty(frame, 'clientWidth', {
    configurable: true,
    value: 595,
  });
  Object.defineProperty(frame, 'clientHeight', {
    configurable: true,
    value: 842,
  });
  Object.defineProperty(frame.contentDocument!.documentElement, 'clientWidth', {
    configurable: true,
    value: 595,
  });
  return { frame, onReady, onError };
}

describe('PagedExportPreviewPage', () => {
  afterEach(() => cleanup());

  it('paginates image pages with format-aware accessible titles', async () => {
    const { frame, onReady, onError } = renderPage();
    const frameDocument = frame.contentDocument!;
    frameDocument.body.innerHTML =
      '<main class="markdowner-export"><p>First page</p><p>More content</p></main>';
    const paragraphs = frameDocument.querySelectorAll('p');
    vi.spyOn(paragraphs[0], 'getBoundingClientRect').mockReturnValue(rect(40, 100));
    vi.spyOn(paragraphs[1], 'getBoundingClientRect').mockReturnValue(rect(1_700, 100));

    fireEvent.load(frame);

    await waitFor(() =>
      expect(onReady).toHaveBeenCalledWith({
        type: PDF_PREVIEW_READY_MESSAGE,
        token: 'preview-7',
        pageIndex: 1,
        pageCount: 3,
        pageWidth: 595.2755905511812,
        pageHeight: 841.8897637795276,
      }),
    );
    expect(onError).not.toHaveBeenCalled();
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
  });

  it('reports iframe failures', () => {
    const { frame, onError } = renderPage('PDF');

    fireEvent.error(frame);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('waits until the iframe receives a measurable layout', async () => {
    const { frame, onReady, onError } = renderPage('PDF');
    const frameDocument = frame.contentDocument!;
    frameDocument.body.innerHTML =
      '<main class="markdowner-export"><p>First page</p><p>More content</p></main>';
    const paragraphs = frameDocument.querySelectorAll('p');
    vi.spyOn(paragraphs[0], 'getBoundingClientRect').mockReturnValue(rect(40, 100));
    vi.spyOn(paragraphs[1], 'getBoundingClientRect').mockReturnValue(rect(1_700, 100));
    let layoutReady = false;
    Object.defineProperty(frame, 'clientWidth', {
      configurable: true,
      get: () => (layoutReady ? 595 : 0),
    });
    Object.defineProperty(frame, 'clientHeight', {
      configurable: true,
      get: () => (layoutReady ? 842 : 0),
    });
    Object.defineProperty(frameDocument.documentElement, 'clientWidth', {
      configurable: true,
      get: () => (layoutReady ? 595 : 0),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      layoutReady = true;
      callback(0);
      return 1;
    });

    fireEvent.load(frame);

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(onReady).toHaveBeenLastCalledWith(expect.objectContaining({ pageCount: 3 }));
    expect(onError).not.toHaveBeenCalled();
  });
});
