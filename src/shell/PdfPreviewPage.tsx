import { useEffect, useRef } from 'react';

import {
  PDF_PREVIEW_CONFIG_MESSAGE,
  isPdfPreviewReadyMessage,
  type PdfPreviewReadyMessage,
} from '@/lib/pdfPagination';

export interface PdfPreviewPageProps {
  html: string;
  token: string;
  pageIndex: number;
  pageCount: number;
  width: number;
  height: number;
  backgroundColor: string;
  onReady: (result: PdfPreviewReadyMessage) => void;
  onError: () => void;
}

export function PdfPreviewPage({
  html,
  token,
  pageIndex,
  pageCount,
  width,
  height,
  backgroundColor,
  onReady,
  onError,
}: PdfPreviewPageProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const data =
        event.data && typeof event.data === 'object'
          ? (event.data as Record<string, unknown>)
          : null;
      if (!data || data.token !== token) return;
      if (
        !isPdfPreviewReadyMessage(data, token) ||
        data.pageIndex !== pageIndex ||
        Math.abs(data.pageWidth - width) > 0.001 ||
        Math.abs(data.pageHeight - height) > 0.001
      ) {
        onError();
        return;
      }
      onReady(data);
    };

    const frame = iframeRef.current;
    window.addEventListener('message', handleMessage);
    frame?.addEventListener('error', onError);
    return () => {
      window.removeEventListener('message', handleMessage);
      frame?.removeEventListener('error', onError);
    };
  }, [height, onError, onReady, pageIndex, token, width]);

  const configurePage = () => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: PDF_PREVIEW_CONFIG_MESSAGE,
        token,
        pageIndex,
      },
      '*',
    );
  };

  return (
    <figure className="m-0 grid shrink-0 gap-2" style={{ width }}>
      <div
        className="overflow-hidden border border-border/70 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.45)]"
        style={{ width, height, backgroundColor }}
      >
        <iframe
          ref={iframeRef}
          title={`PDF preview page ${pageIndex + 1}`}
          sandbox="allow-scripts"
          srcDoc={html}
          onLoad={configurePage}
          className="block border-0"
          style={{ width, height, backgroundColor }}
        />
      </div>
      <figcaption className="text-center text-xs tabular-nums text-muted-foreground">
        Page {pageIndex + 1} / {pageCount}
      </figcaption>
    </figure>
  );
}
