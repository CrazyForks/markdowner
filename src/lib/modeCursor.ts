import type { Editor as TiptapEditor } from '@tiptap/react';

export interface SourceCursorLocation {
  line: number;
  column: number;
}

export interface SourceLineReader {
  lines: number;
  line: (lineNumber: number) => {
    from: number;
    length: number;
  };
}

export interface SourceEditorSelection {
  anchor: number;
  head: number;
}

type WysiwygSelection = {
  from: number;
  head?: number;
};

function wysiwygSelectionHead(selection: WysiwygSelection): number {
  return typeof selection.head === 'number' ? selection.head : selection.from;
}

export function sourceEditorSelectionForLocation(
  doc: SourceLineReader,
  location: SourceCursorLocation,
): SourceEditorSelection {
  const maxLine = Math.max(1, doc.lines);
  const targetLine =
    Number.isFinite(location.line) && location.line >= 1
      ? Math.min(location.line, maxLine)
      : 1;
  const lineInfo = doc.line(targetLine);
  const targetColumn =
    Number.isFinite(location.column) && location.column >= 1
      ? Math.min(location.column, lineInfo.length + 1)
      : 1;
  const offset = lineInfo.from + (targetColumn - 1);

  return {
    anchor: offset,
    head: offset,
  };
}

// Returns the markdown source line + column corresponding to the current
// WYSIWYG selection. Serialises the document prefix up to the cursor through
// @tiptap/markdown and counts newlines for the line, and characters since the
// last newline for the column — accurate for paragraphs, headings, lists, code
// fences, and any other block @tiptap/markdown can round-trip.
//
// Falls back to {line: 1, column: 1} on serialiser failure so callers can treat
// the result as a best-effort hint rather than a hard contract.
export function wysiwygCursorSourceLocation(editor: TiptapEditor | null): SourceCursorLocation {
  if (!editor) return { line: 1, column: 1 };
  const selection = editor.state.selection;
  const head = wysiwygSelectionHead(selection);
  if (head <= 0) return { line: 1, column: 1 };
  try {
    const slice = editor.state.doc.cut(0, head);
    const serializer = getMarkdownSerializer(editor);
    if (!serializer) return { line: 1, column: 1 };
    const markdown = serializer.serialize(slice);
    let line = 1;
    let lastNewline = -1;
    for (let index = 0; index < markdown.length; index += 1) {
      if (markdown[index] === '\n') {
        line += 1;
        lastNewline = index;
      }
    }
    const column = markdown.length - (lastNewline + 1) + 1;
    return { line, column: Math.max(1, column) };
  } catch {
    return { line: 1, column: 1 };
  }
}

// Returns the ProseMirror position that corresponds to the given markdown
// source location (line + column) in the current WYSIWYG document. Falls back
// to the start of the block when the column is past the block's text length.
export function wysiwygPositionAtSourceLocation(
  editor: TiptapEditor | null,
  location: SourceCursorLocation,
): number | null {
  if (!editor) return null;
  const targetLine = Number.isFinite(location.line) && location.line >= 1 ? location.line : 1;
  const targetColumn =
    Number.isFinite(location.column) && location.column >= 1 ? location.column : 1;
  const serializer = getMarkdownSerializer(editor);
  if (!serializer) return null;

  const doc = editor.state.doc;
  let cumulativeLines = 1;
  let positionAfterPreviousBlocks = 0;
  let candidate: number | null = null;
  let candidateBlockNode: { nodeSize: number; textContent: string } | null = null;

  try {
    doc.forEach((node, offset) => {
      if (candidate !== null) return;
      const blockOpenPosition = offset + 1; // skip past the opening token
      if (cumulativeLines >= targetLine) {
        candidate = blockOpenPosition;
        candidateBlockNode = node;
        return;
      }
      const sliceEnd = offset + node.nodeSize;
      const slice = doc.cut(0, sliceEnd);
      const markdown = serializer.serialize(slice);
      let lines = 1;
      for (let index = 0; index < markdown.length; index += 1) {
        if (markdown[index] === '\n') lines += 1;
      }
      if (lines >= targetLine) {
        candidate = blockOpenPosition;
        candidateBlockNode = node;
        return;
      }
      cumulativeLines = lines;
      positionAfterPreviousBlocks = sliceEnd;
    });
  } catch {
    return null;
  }

  if (candidate === null) {
    return Math.max(0, positionAfterPreviousBlocks - 1);
  }

  if (targetColumn <= 1 || candidateBlockNode === null) return candidate;
  // Subtract the block's markdown prefix length (e.g. `## ` for an h2, `> `
  // for a blockquote) so a column that the wysiwyg→source side reported as
  // including the prefix maps back to an offset inside the block's text.
  // Only paragraphs and headings are handled here — list items / quotes
  // nest sub-blocks and can't be advanced safely with a flat character
  // count, so we leave the caret at the block's start in those cases.
  const node = candidateBlockNode as {
    type?: { name?: string };
    attrs?: { level?: number };
    textContent: string;
  };
  const typeName = node.type?.name;
  let prefixLength = 0;
  if (typeName === 'heading') {
    const level = Math.max(1, Math.min(6, node.attrs?.level ?? 1));
    prefixLength = level + 1; // e.g. "## "
  } else if (typeName !== 'paragraph') {
    // Unknown / structural block — don't risk landing inside a child node.
    return candidate;
  }
  const maxAdvance = Math.max(0, node.textContent.length);
  const advance = Math.min(Math.max(0, targetColumn - 1 - prefixLength), maxAdvance);
  return candidate + advance;
}

// Backwards-compatible helpers retained for callers that only need a line.
export function wysiwygCursorSourceLine(editor: TiptapEditor | null): number {
  return wysiwygCursorSourceLocation(editor).line;
}

export function wysiwygPositionAtSourceLine(
  editor: TiptapEditor | null,
  targetLine: number,
): number | null {
  return wysiwygPositionAtSourceLocation(editor, { line: targetLine, column: 1 });
}

// Returns the markdown character offset of the WYSIWYG cursor — "where would
// the cursor be if you dropped me into the markdown source at this point".
// Computed by serializing the doc prefix up to the active selection head and
// taking its length, so it's symmetric with the source editor's native character-offset
// cursor model (which is what we need for an exact mode-switch round-trip).
export function wysiwygCursorMarkdownOffset(editor: TiptapEditor | null): number {
  if (!editor) return 0;
  const head = wysiwygSelectionHead(editor.state.selection);
  if (head <= 0) return 0;
  try {
    const slice = editor.state.doc.cut(0, head);
    const serializer = getMarkdownSerializer(editor);
    if (!serializer) return 0;
    return serializer.serialize(slice).length;
  } catch {
    return 0;
  }
}

// Inverse of `wysiwygCursorMarkdownOffset`: returns the ProseMirror position
// that corresponds to the given markdown character offset. Binary-searches
// the doc for the smallest position whose serialized prefix length matches
// the target — by asking the markdown serializer at each step, we get
// pixel-perfect handoff inside any block the serializer round-trips
// (paragraphs, headings, lists, blockquotes, code fences, tables, …)
// without baking block-specific prefix arithmetic into this file.
export function wysiwygPositionAtMarkdownOffset(
  editor: TiptapEditor | null,
  targetOffset: number,
): number | null {
  if (!editor) return null;
  if (!Number.isFinite(targetOffset) || targetOffset <= 0) return 0;
  const serializer = getMarkdownSerializer(editor);
  if (!serializer) return null;

  const doc = editor.state.doc;
  const docSize = doc.content.size;
  if (docSize <= 0) return 0;

  try {
    const fullLength = serializer.serialize(doc).length;
    // `docSize - 1` is the last position that sits *inside* a block's text
    // (just before its closing token); `docSize` itself is after the doc's
    // last child and Tiptap can refuse to land a selection there.
    const lastTextPosition = Math.max(0, docSize - 1);
    if (targetOffset >= fullLength) return lastTextPosition;

    // Smallest position `pos` such that serialize(cut(0, pos)).length >= target.
    let low = 0;
    let high = docSize;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const prefixLength = serializer.serialize(doc.cut(0, mid)).length;
      if (prefixLength < targetOffset) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return Math.min(low, lastTextPosition);
  } catch {
    return null;
  }
}

type Serializer = {
  serialize: (doc: unknown) => string;
};

// Adapter around @tiptap/markdown's `MarkdownManager.serialize(json)`.
// The manager is exposed at `editor.storage.markdown.manager` and accepts
// Tiptap JSON content, not a ProseMirror Node — so we toJSON() the slice
// before forwarding. Earlier revisions of this helper looked for a
// `storage.markdown.serializer` field, which never existed on the live
// extension and made every offset computation collapse to 0 (the silent
// fallback inside wysiwygCursorMarkdownOffset). That cascaded into the
// mode-switch handoff sending the source caret to position 0 every time
// the user pressed Option+2 from a non-trivial caret position.
function getMarkdownSerializer(editor: TiptapEditor): Serializer | null {
  const storage = editor.storage as
    | { markdown?: { manager?: { serialize?: (json: unknown) => string } } }
    | undefined;
  const manager = storage?.markdown?.manager;
  if (!manager || typeof manager.serialize !== 'function') return null;
  return {
    serialize(doc: unknown) {
      const json =
        doc && typeof (doc as { toJSON?: () => unknown }).toJSON === 'function'
          ? (doc as { toJSON: () => unknown }).toJSON()
          : doc;
      try {
        return manager.serialize!(json);
      } catch {
        return '';
      }
    },
  };
}
