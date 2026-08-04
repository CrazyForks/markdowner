import { useEffect, useRef, useState } from 'react';

import { waitForExportPreviewAssets, waitForExportPreviewLayout } from '@/lib/exportPreviewFrame';

export interface ContinuousExportPreviewSize {
  width: number;
  height: number;
}

export interface ContinuousExportPreviewProps {
  html: string;
  width: number;
  backgroundColor: string;
  onReady: (size: ContinuousExportPreviewSize) => void;
  onError: () => void;
}

export function ContinuousExportPreview({
  html,
  width,
  backgroundColor,
  onReady,
  onError,
}: ContinuousExportPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewRequestRef = useRef(0);
  const [height, setHeight] = useState(1);

  useEffect(() => {
    previewRequestRef.current += 1;
    setHeight(1);
  }, [html, width]);

  useEffect(() => {
    const frame = iframeRef.current;
    frame?.addEventListener('error', onError);
    return () => frame?.removeEventListener('error', onError);
  }, [onError]);

  const measure = () => {
    const frame = iframeRef.current;
    const frameDocument = frame?.contentDocument;
    if (!frame || !frameDocument) {
      onError();
      return;
    }
    const previewRequest = ++previewRequestRef.current;

    void waitForExportPreviewAssets(frameDocument)
      .then(() => waitForExportPreviewLayout(frame, frameDocument))
      .then(() => {
        if (
          previewRequest !== previewRequestRef.current ||
          iframeRef.current !== frame ||
          frame.contentDocument !== frameDocument
        ) {
          return;
        }
        const content = frameDocument.querySelector('.markdowner-export');
        if (!(content instanceof frameDocument.defaultView!.HTMLElement)) {
          throw new Error('Continuous image preview content is unavailable.');
        }
        const rect = content.getBoundingClientRect();
        if (
          !Number.isFinite(rect.width) ||
          !Number.isFinite(rect.height) ||
          rect.width <= 0 ||
          rect.height <= 0
        ) {
          throw new Error('Continuous image preview has invalid dimensions.');
        }
        setHeight(rect.height);
        onReady({ width: rect.width, height: rect.height });
      })
      .catch(() => {
        if (previewRequest === previewRequestRef.current) onError();
      });
  };

  return (
    <div
      className="overflow-hidden border border-border/70 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.45)]"
      style={{ width, height, backgroundColor }}
    >
      <iframe
        ref={iframeRef}
        title="Continuous image preview"
        sandbox="allow-same-origin"
        srcDoc={html}
        onLoad={measure}
        className="block border-0"
        style={{ width, height, backgroundColor }}
      />
    </div>
  );
}
