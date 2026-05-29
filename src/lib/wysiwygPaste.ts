import { Fragment, Slice } from '@tiptap/pm/model';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

// Matches URLs we recognise as auto-linkable inside pasted plain text.
// Conservative on purpose: requires an explicit `http(s)://` (or `mailto:`,
// `tel:`) scheme so bare words like `index.tsx` or `a.b.c` aren't linked.
// Trailing punctuation is excluded so "see https://example.com." does the
// expected thing (the trailing period stays outside the link).
const URL_PATTERN =
  /\b((?:https?:\/\/|mailto:|tel:)[^\s<>()[\]{}'"`]+[^\s<>()[\]{}'"`.,;:!?])/g;

// ProseMirror node types that are indistinguishable from a plain-text paste.
// A document built only from these, with no marks, round-trips through plain
// text unchanged — so routing it through the markdown path would gain nothing
// (and risks subtle reflows). Anything outside this set (heading, list, table,
// code block, blockquote, image, …) is genuine block structure.
const TRIVIAL_NODE_TYPES = new Set(['doc', 'paragraph', 'text', 'hardBreak']);

interface ParsedNode {
  type?: string;
  marks?: unknown[];
  content?: ParsedNode[];
}

/**
 * Walks a parsed ProseMirror JSON document and reports whether it carries any
 * "real" markdown: an inline mark (bold / italic / code / link / strike / …)
 * or a block node beyond plain paragraphs (heading, list, table, code block,
 * blockquote, image, …).
 *
 * This is the signal that distinguishes "the user pasted markdown source they
 * want rendered" from "the user pasted prose that merely contains an
 * asterisk". `5 * 3 = 15`, `snake_case`, and `C:\path\file` all parse to a
 * single plain paragraph → no formatting → false; `**bold**`, `# heading`,
 * setext `===`, and GFM tables → true.
 *
 * Parsing first (instead of a regex pre-filter) is what lets inline-only
 * markdown render: a leading `#` is no longer required to recognise that the
 * clipboard held markdown source.
 */
export function parsedDocHasFormatting(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const visit = (node: ParsedNode): boolean => {
    if (Array.isArray(node.marks) && node.marks.length > 0) return true;
    if (node.type && !TRIVIAL_NODE_TYPES.has(node.type)) return true;
    if (Array.isArray(node.content)) return node.content.some(visit);
    return false;
  };
  return visit(doc as ParsedNode);
}

interface ViewInputLike {
  input?: { shiftKey?: boolean; lastKeyCode?: number | null };
}

/**
 * Mirrors ProseMirror's own "prefer plain" rule. prosemirror-view tracks
 * `view.input.shiftKey` / `lastKeyCode` on every keydown; a paste fired while
 * Shift is held (Cmd/Ctrl+Shift+V) is a "paste as plain text" request — except
 * Shift+Insert (keyCode 45), which is just an alternative paste chord. Routing
 * that case here makes the paste bypass markdown rendering and land verbatim.
 */
export function isPlainTextPasteRequest(view: ViewInputLike): boolean {
  const input = view?.input;
  if (!input) return false;
  return !!input.shiftKey && input.lastKeyCode !== 45;
}

function linkMarkForHref(schema: Schema, href: string): Mark | null {
  const linkType = schema.marks.link;
  if (!linkType) return null;
  return linkType.create({ href });
}

// Split a plain-text run into inline ProseMirror nodes, applying the link
// mark to substrings that look like URLs. Non-URL chunks become plain text;
// URL chunks become text wrapped in a `link` mark so the resulting paragraph
// contains clickable links the moment the paste lands.
function buildInlineFromText(schema: Schema, text: string): ProseMirrorNode[] {
  if (text.length === 0) return [];
  const linkType = schema.marks.link;
  if (!linkType) return [schema.text(text)];

  const out: ProseMirrorNode[] = [];
  let cursor = 0;
  // String#matchAll requires the /g flag and would consume the regex's
  // lastIndex across iterations; using exec with explicit lastIndex keeps
  // the state local to this call.
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[1].length;
    if (start > cursor) {
      out.push(schema.text(text.slice(cursor, start)));
    }
    const href = match[1];
    const linkMark = linkMarkForHref(schema, href);
    out.push(linkMark ? schema.text(href, [linkMark]) : schema.text(href));
    cursor = end;
  }
  if (cursor < text.length) {
    out.push(schema.text(text.slice(cursor)));
  }
  return out;
}

/**
 * Builds an "open" Slice of paragraph nodes from a plain-text string, suitable
 * for `Transaction.replaceSelection`. The slice has openStart/openEnd = 1 so
 * the first and last paragraph merge with the surrounding block at the paste
 * point instead of starting a brand-new paragraph at the caret.
 *
 * Splits on blank lines (`\n{2,}`) to produce separate paragraphs. Single
 * newlines inside a paragraph become hard breaks, matching what users get
 * from a normal text-mode paste. URL-looking substrings are wrapped in `link`
 * marks so pasting "see https://example.com" lands a clickable link in one
 * step instead of leaving the user to re-select and apply the link by hand.
 */
export function buildPlainTextPasteSlice(schema: Schema, text: string): Slice {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);

  const paragraphNodes: ProseMirrorNode[] = blocks.map((block) => {
    const lines = block.split('\n');
    const inline: ProseMirrorNode[] = [];
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        inline.push(schema.nodes.hardBreak.create());
      }
      if (line.length > 0) {
        inline.push(...buildInlineFromText(schema, line));
      }
    });
    return schema.nodes.paragraph.create(null, inline);
  });

  if (paragraphNodes.length === 0) {
    return Slice.empty;
  }

  return new Slice(Fragment.from(paragraphNodes), 1, 1);
}

// Shape we accept for the @tiptap/markdown manager exposed on
// `editor.storage.markdown.manager`. We pluck `parse` at runtime so missing /
// older versions degrade to plain-text paste instead of throwing.
interface MarkdownManagerLike {
  parse?: (markdown: string) => unknown;
  hasMarked?: () => boolean;
}

// Loose duck-typed view of the Tiptap editor — using `any` here keeps us
// compatible with both the real `@tiptap/react` Editor type and the lighter
// mocks the unit tests pass in, without dragging the full Tiptap type
// definitions through this file.
interface EditorLike {
  storage?: { markdown?: { manager?: MarkdownManagerLike } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commands?: { insertContent?: (content: any) => boolean };
}

/**
 * If the editor exposes a @tiptap/markdown manager, parse the pasted text
 * through it and — only when the result carries real formatting or structure
 * (see `parsedDocHasFormatting`) — insert it via `editor.commands.insertContent`
 * so the user gets rendered blocks instead of literal markdown characters.
 *
 * Returns true when the markdown path fully handled the paste so the caller can
 * short-circuit; returns false to fall through to the plain-text behaviour
 * (plain prose, ambiguous asterisks, file paths, …).
 */
function tryPasteAsMarkdown(editor: EditorLike | null, text: string): boolean {
  if (!editor) return false;
  const manager = editor.storage?.markdown?.manager;
  if (!manager || typeof manager.parse !== 'function') return false;
  if (typeof manager.hasMarked === 'function' && !manager.hasMarked()) return false;
  if (typeof editor.commands?.insertContent !== 'function') return false;
  let parsed: unknown;
  try {
    parsed = manager.parse(text);
  } catch {
    return false;
  }
  if (!parsedDocHasFormatting(parsed)) return false;
  try {
    const ok = editor.commands.insertContent(parsed);
    return ok !== false;
  } catch {
    return false;
  }
}

/**
 * Tiptap `editorProps.handlePaste` that drives WYSIWYG paste behaviour.
 *
 * The browser's default paste handler prefers `text/html` over `text/plain`.
 * Sources like browser devtools, React inspector tools (react-grab), and
 * some terminals push HTML to the clipboard that contains unknown elements
 * (`<SidebarInset>`, custom `data-*` divs, …) or malformed markup.
 * ProseMirror's DOMParser silently drops what its schema can't map, so the
 * pasted content loses chunks that the user actually copied.
 *
 * We instead lean on `text/plain` — which mirrors what the user visibly
 * highlighted — and route it through two paths in order:
 *
 *   1. We parse it through @tiptap/markdown. If the parse yields real
 *      formatting or structure — inline marks (`**bold**`, `*italic*`,
 *      `` `code` ``, `[link](url)`, `~~strike~~`) or block nodes (headings,
 *      lists, tables, blockquotes, code fences, setext `===`, …) — we insert
 *      the rendered result so the user gets the formatted blocks they'd
 *      expect from a markdown editor.
 *
 *   2. Otherwise we insert the text verbatim, auto-linking any URLs along
 *      the way (see `buildPlainTextPasteSlice`). This is also what happens
 *      for ambiguous prose like "5 * 3 = 15" (marked leaves it a plain
 *      paragraph) and what `forcePlainText` forces unconditionally.
 *
 * `forcePlainText` (Cmd/Ctrl+Shift+V — see `isPlainTextPasteRequest`) skips the
 * markdown path entirely so the raw characters land as typed.
 *
 * Returns `true` to short-circuit the default handler when we've handled
 * the paste; falls through (`false`) for clipboard payloads without text
 * (image/file pastes still work via the default path).
 */
export function handleWysiwygPlainTextPaste(
  view: EditorView,
  event: ClipboardEvent,
  editor: EditorLike | null = null,
  forcePlainText = false,
): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return false;
  const text = clipboardData.getData('text/plain');
  if (!text) return false;

  if (!forcePlainText && tryPasteAsMarkdown(editor, text)) {
    return true;
  }

  const slice = buildPlainTextPasteSlice(view.state.schema, text);
  if (slice.size === 0) return false;

  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  return true;
}
