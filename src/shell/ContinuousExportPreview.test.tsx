import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContinuousExportPreview } from './ContinuousExportPreview';

function renderPreview() {
  const onReady = vi.fn();
  const onError = vi.fn();
  render(
    <ContinuousExportPreview
      html="<!doctype html><html><body><main class='markdowner-export'>Preview</main></body></html>"
      width={595.2755905511812}
      backgroundColor="#ffffff"
      onReady={onReady}
      onError={onError}
    />,
  );
  const frame = screen.getByTitle('Continuous image preview') as HTMLIFrameElement;
  Object.defineProperty(frame, 'clientWidth', {
    configurable: true,
    value: 595,
  });
  Object.defineProperty(frame, 'clientHeight', {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(frame.contentDocument!.documentElement, 'clientWidth', {
    configurable: true,
    value: 595,
  });
  return { frame, onReady, onError };
}

describe('ContinuousExportPreview', () => {
  afterEach(() => cleanup());

  it('waits for assets and reports finite continuous content dimensions', async () => {
    const { frame, onReady, onError } = renderPreview();
    const frameDocument = frame.contentDocument!;
    frameDocument.body.innerHTML = '<main class="markdowner-export">Preview</main>';
    vi.spyOn(
      frameDocument.querySelector('.markdowner-export')!,
      'getBoundingClientRect',
    ).mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 595.2755905511812,
      bottom: 1_420.5,
      left: 0,
      width: 595.2755905511812,
      height: 1_420.5,
      toJSON: () => ({}),
    });

    fireEvent.load(frame);

    await waitFor(() =>
      expect(onReady).toHaveBeenCalledWith({
        width: 595.2755905511812,
        height: 1_420.5,
      }),
    );
    expect(onError).not.toHaveBeenCalled();
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
  });

  it('reports iframe failures', () => {
    const { frame, onError } = renderPreview();

    fireEvent.error(frame);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('ignores a completed measurement after its HTML was replaced', async () => {
    let resolveFonts: (() => void) | undefined;
    const onReady = vi.fn();
    const onError = vi.fn();
    const { rerender } = render(
      <ContinuousExportPreview
        html="first"
        width={595}
        backgroundColor="#ffffff"
        onReady={onReady}
        onError={onError}
      />,
    );
    const frame = screen.getByTitle('Continuous image preview') as HTMLIFrameElement;
    const frameDocument = frame.contentDocument!;
    Object.defineProperty(frame, 'clientWidth', {
      configurable: true,
      value: 595,
    });
    Object.defineProperty(frame, 'clientHeight', {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(frameDocument.documentElement, 'clientWidth', {
      configurable: true,
      value: 595,
    });
    Object.defineProperty(frameDocument, 'fonts', {
      configurable: true,
      value: {
        ready: new Promise<void>((resolve) => (resolveFonts = resolve)),
      },
    });
    frameDocument.body.innerHTML = '<main class="markdowner-export">First</main>';

    fireEvent.load(frame);
    rerender(
      <ContinuousExportPreview
        html="second"
        width={595}
        backgroundColor="#ffffff"
        onReady={onReady}
        onError={onError}
      />,
    );
    await act(async () => resolveFonts?.());

    expect(onReady).not.toHaveBeenCalled();
  });
});
