import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { createSourceLineMarkdownComponents } from './sourceLineComponents';
import { MARKDOWN_CONTENT_SCOPE_CLASS } from './themeScope';

const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdown|mkd)$/i;

/** Strip the markdown extension from a document name for an export filename. */
export function exportBaseName(activeDocumentName: string | null | undefined): string {
  if (!activeDocumentName) return 'Untitled';
  return activeDocumentName.replace(MARKDOWN_EXTENSION_RE, '') || 'Untitled';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render markdown to the same static HTML the split-view preview shows: GFM
 * tables/task-lists via remark-gfm, and lowlight-highlighted code blocks via
 * the shared preview components. Reusing those components keeps the export
 * pixel-identical to the in-app preview.
 */
export function renderMarkdownToHtml(
  source: string,
  activeDocumentPath: string | null,
): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        components: createSourceLineMarkdownComponents({ activeDocumentPath }),
      },
      source,
    ),
  );
}

/**
 * Concatenate every same-origin stylesheet's rules. Cross-origin sheets throw
 * on `.cssRules` access and are skipped. This captures the app's bundled CSS
 * (markdown-surface typography + the active code-block palette) plus any
 * imported custom theme `<style>`, so the export renders without the app.
 */
function collectDocumentCss(doc: Document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null; // cross-origin stylesheet — not readable
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) parts.push(rule.cssText);
  }
  return parts.join('\n');
}

/**
 * Mirror the live `<html>` element's attributes (data-theme, data-cb-theme,
 * data-cb-highlight, class, …) so the exported document inherits the exact
 * on-screen theme — light/dark and the chosen code-block palette.
 */
function rootAttributes(doc: Document): string {
  return Array.from(doc.documentElement.attributes)
    .map((attr) => `${attr.name}="${escapeHtml(attr.value)}"`)
    .join(' ');
}

export interface ExportHtmlOptions {
  title: string;
  source: string;
  activeDocumentPath: string | null;
  /** Add print page rules (used by PDF export via the print dialog). */
  forPrint?: boolean;
  paperSize?: 'A4' | 'Letter';
  /** Injectable for tests; defaults to the live document. */
  doc?: Document;
}

/**
 * Build a self-contained, styled HTML document for the current markdown. Used
 * for both "Export to HTML" (written to disk) and "Export to PDF" (printed from
 * a hidden iframe).
 */
export function buildExportHtml(options: ExportHtmlOptions): string {
  const {
    title,
    source,
    activeDocumentPath,
    forPrint = false,
    paperSize = 'A4',
    doc = document,
  } = options;

  const body = renderMarkdownToHtml(source, activeDocumentPath);
  const css = collectDocumentCss(doc);
  const pageRule = forPrint ? `@page { size: ${paperSize}; margin: 16mm; }` : '';
  const exportCss = `${css}
${pageRule}
html, body { margin: 0; background: var(--background, #ffffff); }
.markdowner-export { box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 40px 32px; }`;

  return `<!doctype html>
<html ${rootAttributes(doc)}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${exportCss}</style>
</head>
<body>
<div class="markdowner-export ${MARKDOWN_CONTENT_SCOPE_CLASS} markdown-surface">
${body}
</div>
</body>
</html>`;
}

/**
 * Print a standalone HTML document via a hidden, same-origin iframe so only the
 * document (not the app chrome) reaches the print dialog. On macOS WebKit the
 * dialog offers "Save as PDF", which is how PDF export is realised without a
 * native PDF dependency.
 */
export function printExportedHtml(html: string, doc: Document = document): void {
  if (typeof doc === 'undefined') return;
  const iframe = doc.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  iframe.srcdoc = html;
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    // Defer a frame so layout and fonts settle before the print snapshot.
    win.requestAnimationFrame(() => {
      win.focus();
      win.print();
      // Remove after the dialog has had time to read the document.
      win.setTimeout(() => iframe.remove(), 1000);
    });
  };
  doc.body.appendChild(iframe);
}
