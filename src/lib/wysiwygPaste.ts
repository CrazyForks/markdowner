import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

/**
 * Builds an "open" Slice of paragraph nodes from a plain-text string, suitable
 * for `Transaction.replaceSelection`. The slice has openStart/openEnd = 1 so
 * the first and last paragraph merge with the surrounding block at the paste
 * point instead of starting a brand-new paragraph at the caret.
 *
 * Splits on blank lines (`\n{2,}`) to produce separate paragraphs. Single
 * newlines inside a paragraph become hard breaks, matching what users get
 * from a normal text-mode paste.
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
        inline.push(schema.text(line));
      }
    });
    return schema.nodes.paragraph.create(null, inline);
  });

  if (paragraphNodes.length === 0) {
    return Slice.empty;
  }

  return new Slice(Fragment.from(paragraphNodes), 1, 1);
}

/**
 * Tiptap `editorProps.handlePaste` that forces plain-text pasting in the
 * WYSIWYG surface.
 *
 * Why: ProseMirror's default paste handler prefers `text/html` over
 * `text/plain`. Sources like browser devtools, React inspector tools
 * (react-grab), and some terminals push HTML to the clipboard that contains
 * unknown elements (`<SidebarInset>`, custom `data-*` divs, …) or malformed
 * markup. ProseMirror's DOMParser silently drops what its schema can't map,
 * so the pasted content loses chunks that the user actually copied.
 *
 * Preferring `text/plain` mirrors what the user visibly highlighted in the
 * source app and keeps the paste verbatim. Markdown formatting from the
 * source (bold, italic, lists) is lost, which is the right trade for a
 * markdown editor where the user can type that syntax explicitly.
 *
 * Returns `true` to short-circuit the default handler when plain text is
 * available; falls through (`false`) for clipboard payloads without text
 * (image/file pastes still work via the default path).
 */
export function handleWysiwygPlainTextPaste(
  view: EditorView,
  event: ClipboardEvent,
): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return false;
  const text = clipboardData.getData('text/plain');
  if (!text) return false;

  const slice = buildPlainTextPasteSlice(view.state.schema, text);
  if (slice.size === 0) return false;

  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  return true;
}
