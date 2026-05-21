import {
  openDocument,
  openExternalUrl,
  openPathInDefaultApp,
  resolveMarkdownLink,
  type ResolvedLink,
} from './desktop';

/**
 * Routes a markdown link href through the right desktop action:
 * - markdown file → open it as a new editor tab
 * - other local file → ask the OS to handle (Finder / Preview / …)
 * - external URL → open in the default browser
 * - anchor (#heading) → caller handles in-document scroll
 *
 * `basePath` should be the active document's absolute path so relative
 * targets like `../other.md` resolve correctly. Pass `null` when no document
 * is open (relative paths will then resolve to "unresolved").
 *
 * Returns the classification so callers can react (e.g. show a toast on
 * "unresolved" or scroll to the anchor themselves).
 */
export async function openMarkdownLink(
  href: string,
  basePath: string | null,
  options: { onMarkdownOpened?: () => void } = {},
): Promise<ResolvedLink> {
  const resolved = await resolveMarkdownLink(href, basePath);

  switch (resolved.kind) {
    case 'markdown':
      await openDocument(resolved.absolutePath);
      options.onMarkdownOpened?.();
      return resolved;
    case 'file':
      await openPathInDefaultApp(resolved.absolutePath);
      return resolved;
    case 'external':
      await openExternalUrl(resolved.href);
      return resolved;
    case 'anchor':
    case 'unresolved':
      return resolved;
  }
}

/**
 * Match against the user's intent to open a link from inside the editor —
 * Cmd+Click on macOS, Ctrl+Click on Windows/Linux. Matches the VS Code / Zed
 * convention so the click target lands its caret normally without the
 * modifier, but jumps to the linked resource with it.
 */
export function isOpenLinkClick(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  if (typeof navigator === 'undefined') return event.metaKey || event.ctrlKey;
  return navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey;
}
