import { EditorView } from '@uiw/react-codemirror';

import { isOpenLinkClick, openMarkdownLink } from './linkOpener';

/**
 * CodeMirror extension that opens the link under the cursor when the user
 * Cmd+Clicks (or Ctrl+Clicks on Windows/Linux). Mirrors the WYSIWYG /
 * Split-View preview behavior so users get the same "modifier + click =
 * follow link" convention everywhere VS Code / Zed put it.
 *
 * The `getBasePath` callback returns the active document's absolute path so
 * relative targets like `[notes](./other.md)` resolve correctly.
 */
export function createSourceLinkClickExtension(getBasePath: () => string | null) {
  return EditorView.domEventHandlers({
    click(event, view) {
      if (!isOpenLinkClick(event)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      const offsetInLine = pos - line.from;
      const url = findEnclosingLinkUrl(line.text, offsetInLine);
      if (!url) return false;
      event.preventDefault();
      void openMarkdownLink(url, getBasePath()).catch(() => {
        // Non-fatal — user can always copy/paste manually.
      });
      return true;
    },
  });
}

/**
 * Lightweight inline scanner. We don't want to pull in a full markdown AST
 * just to detect link spans, so we match `[text](url)` (and the bare
 * `[text](url "title")` variant) per-line and return the URL token when
 * offset falls inside it. Skipping inline code blocks and image refs keeps
 * this a "best effort" affordance — the worst case is a missed click.
 */
function findEnclosingLinkUrl(line: string, offset: number): string | null {
  const pattern = /(!?)\[([^\]\n]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset < start || offset > end) continue;
    // Skip image references `![alt](src)` — those open in the WYSIWYG layer
    // already, and the inline `<img>` they produce here in source mode does
    // not benefit from the OS handler chain.
    if (match[1] === '!') return null;
    const urlAndTitle = match[3].trim();
    if (!urlAndTitle) return null;
    // The optional title (`url "title"`) is whitespace-separated from the
    // URL — keep only the leading URL token.
    const url = urlAndTitle.split(/\s+/, 1)[0] ?? urlAndTitle;
    return url;
  }
  return null;
}
