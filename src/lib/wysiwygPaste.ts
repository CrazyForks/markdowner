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

// Structural markdown patterns. We only auto-parse pasted text as markdown
// when at least one of these block-level shapes is present — inline `*emph*`
// or `**bold**` alone is too ambiguous (a user pasting "5 * 3 = 15" doesn't
// want italic), but a leading `# heading` or fenced code block is an
// unambiguous signal that the source was rendered markdown.
const MARKDOWN_STRUCTURE_PATTERNS: RegExp[] = [
  /^#{1,6}\s\S/m,        // ATX heading: "# Title", "## Sub", ...
  /^```/m,               // Fenced code block
  /^~~~/m,               // Tilde-fenced code block
  /^>\s\S/m,             // Blockquote: "> note"
  /^[-*+]\s\S/m,         // Bullet list: "- item"
  /^\d+\.\s\S/m,         // Numbered list: "1. item"
  /^- \[[ xX]\]\s/m,     // GFM task list: "- [ ] todo"
  /^\|.+\|.+\|/m,        // GFM table row: "| a | b |"
  /^-{3,}\s*$/m,         // Horizontal rule
  /\n\n\!\[[^\]]*\]\([^)]+\)/,  // Block image after blank line
];

/**
 * Heuristic: does this plain-text payload look like rendered markdown source
 * that the user wants converted to formatted blocks on paste?
 *
 * Returns true ONLY when an unambiguous block-level markdown shape is
 * present. Inline-only patterns (e.g. `**bold**`, `[text](url)`) are NOT
 * sufficient — those round-trip through plain text fine, and the user might
 * have intended the literal characters. Conservative on purpose: a false
 * positive (rendering "5 * 3" as italic) is far more jarring than a false
 * negative (pasting markdown source verbatim and letting the user re-paste).
 */
export function pastedTextLooksLikeMarkdown(text: string): boolean {
  if (text.length === 0) return false;
  return MARKDOWN_STRUCTURE_PATTERNS.some((pattern) => pattern.test(text));
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
 * If the editor exposes a @tiptap/markdown manager and the pasted text looks
 * like markdown source, parse it through that manager and insert the result
 * via `editor.commands.insertContent`. Returns true when the markdown path
 * fully handled the paste so the caller can short-circuit; returns false to
 * fall through to the plain-text behaviour.
 */
function tryPasteAsMarkdown(editor: EditorLike | null, text: string): boolean {
  if (!editor) return false;
  if (!pastedTextLooksLikeMarkdown(text)) return false;
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
  if (!parsed || typeof parsed !== 'object') return false;
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
 *   1. If the plain text contains unambiguous markdown structures (ATX
 *      heading, fenced code, list bullet, blockquote, GFM task list, table,
 *      …) we parse it through @tiptap/markdown so the user gets the
 *      formatted blocks they'd expect from a markdown editor.
 *
 *   2. Otherwise we insert the text verbatim, auto-linking any URLs along
 *      the way (see `buildPlainTextPasteSlice`). This avoids surprises like
 *      "5 * 3 = 15" being rendered as italic.
 *
 * Returns `true` to short-circuit the default handler when we've handled
 * the paste; falls through (`false`) for clipboard payloads without text
 * (image/file pastes still work via the default path).
 */
export function handleWysiwygPlainTextPaste(
  view: EditorView,
  event: ClipboardEvent,
  editor: EditorLike | null = null,
): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return false;
  const text = clipboardData.getData('text/plain');
  if (!text) return false;

  if (tryPasteAsMarkdown(editor, text)) {
    return true;
  }

  const slice = buildPlainTextPasteSlice(view.state.schema, text);
  if (slice.size === 0) return false;

  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  return true;
}
