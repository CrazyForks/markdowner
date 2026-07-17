import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PDF_PREVIEW_CONFIG_MESSAGE,
  PDF_PREVIEW_READY_MESSAGE,
} from '@/lib/pdfPagination';

import { PdfPreviewPage } from './PdfPreviewPage';

function renderPage() {
  const onReady = vi.fn();
  const onError = vi.fn();
  render(
    <PdfPreviewPage
      html="<!doctype html><html><body>Preview</body></html>"
      token="preview-7"
      pageIndex={1}
      width={595.2755905511812}
      height={841.8897637795276}
      backgroundColor="#ffffff"
      onReady={onReady}
      onError={onError}
    />,
  );
  const frame = screen.getByTitle('PDF preview page 2') as HTMLIFrameElement;
  return { frame, onReady, onError };
}

function readyMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: PDF_PREVIEW_READY_MESSAGE,
    token: 'preview-7',
    pageIndex: 1,
    pageCount: 3,
    pageWidth: 595.2755905511812,
    pageHeight: 841.8897637795276,
    ...overrides,
  };
}

describe('PdfPreviewPage', () => {
  afterEach(() => cleanup());

  it('posts its page configuration after load and renders a sandboxed page', () => {
    const { frame } = renderPage();
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');

    fireEvent.load(frame);

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: PDF_PREVIEW_CONFIG_MESSAGE,
        token: 'preview-7',
        pageIndex: 1,
      },
      '*',
    );
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('accepts a ready message only from its own frame and current token', () => {
    const { frame, onReady, onError } = renderPage();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: readyMessage(),
        source: frame.contentWindow,
      }),
    );
    expect(onReady).toHaveBeenCalledWith(readyMessage());

    window.dispatchEvent(
      new MessageEvent('message', {
        data: readyMessage({ token: 'stale-token' }),
        source: frame.contentWindow,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: readyMessage(),
        source: window,
      }),
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports malformed current results and iframe failures', () => {
    const { frame, onReady, onError } = renderPage();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: readyMessage({ pageCount: 101 }),
        source: frame.contentWindow,
      }),
    );
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);

    fireEvent.error(frame);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
