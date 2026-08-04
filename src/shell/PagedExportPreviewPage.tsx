import { useEffect, useRef } from 'react';

import { waitForExportPreviewAssets, waitForExportPreviewLayout } from '@/lib/exportPreviewFrame';
import type { PdfPageFurniture, PdfPageInsets } from '@/lib/exportPageLayout';
import {
  PDF_PREVIEW_READY_MESSAGE,
  paginatePdfDocument,
  type PdfPreviewReadyMessage,
} from '@/lib/pdfPagination';
import { MAX_PDF_PAGES } from '@/lib/pdfPaper';

export interface PagedExportPreviewPageProps {
  formatLabel: 'PDF' | 'Image';
  html: string;
  token: string;
  pageIndex: number;
  width: number;
  height: number;
  pageInsets: PdfPageInsets;
  pageFurniture: PdfPageFurniture;
  backgroundColor: string;
  onReady: (result: PdfPreviewReadyMessage) => void;
  onError: () => void;
}

export function PagedExportPreviewPage({
  formatLabel,
  html,
  token,
  pageIndex,
  width,
  height,
  pageInsets,
  pageFurniture,
  backgroundColor,
  onReady,
  onError,
}: PagedExportPreviewPageProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = iframeRef.current;
    frame?.addEventListener('error', onError);
    return () => frame?.removeEventListener('error', onError);
  }, [onError]);

  const paginatePage = () => {
    const frame = iframeRef.current;
    const frameDocument = frame?.contentDocument;
    if (!frame || !frameDocument) {
      onError();
      return;
    }

    void waitForExportPreviewAssets(frameDocument)
      .then(() => waitForExportPreviewLayout(frame, frameDocument))
      .then(() => {
        if (iframeRef.current !== frame || frame.contentDocument !== frameDocument) return;
        const result = paginatePdfDocument(frameDocument, {
          pageWidth: width,
          pageHeight: height,
          pageInsets,
          pageFurniture,
          maxPages: MAX_PDF_PAGES,
        });
        const container =
          (frameDocument.querySelector('.markdowner-export') as HTMLElement | null) ??
          frameDocument.body;
        container.style.transform = `translateY(-${pageIndex * height}px)`;
        container.style.transformOrigin = 'top left';
        frameDocument.documentElement.style.overflow = 'hidden';
        frameDocument.body.style.overflow = 'hidden';
        onReady({
          type: PDF_PREVIEW_READY_MESSAGE,
          token,
          pageIndex,
          pageCount: result.pageCount,
          pageWidth: width,
          pageHeight: height,
        });
      })
      .catch(onError);
  };

  return (
    <div
      className="overflow-hidden border border-border/70 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.45)]"
      style={{ width, height, backgroundColor }}
    >
      <iframe
        ref={iframeRef}
        title={`${formatLabel} preview page ${pageIndex + 1}`}
        sandbox="allow-same-origin"
        srcDoc={html}
        onLoad={paginatePage}
        className="block border-0"
        style={{ width, height, backgroundColor }}
      />
    </div>
  );
}
