import type { Editor as TiptapEditor } from '@tiptap/react';

// Returns the markdown source line (1-indexed) corresponding to the current
// WYSIWYG selection. Serialises the document prefix up to the cursor through
// @tiptap/markdown and counts newlines — accurate for paragraphs, headings,
// lists, code fences, and any other block @tiptap/markdown can round-trip.
//
// Falls back to 1 on serialiser failure so callers can treat the result as a
// best-effort hint rather than a hard contract.
export function wysiwygCursorSourceLine(editor: TiptapEditor | null): number {
  if (!editor) return 1;
  const selection = editor.state.selection;
  const from = selection.from;
  if (from <= 0) return 1;
  try {
    const slice = editor.state.doc.cut(0, from);
    const serializer = getMarkdownSerializer(editor);
    if (!serializer) return 1;
    const markdown = serializer.serialize(slice);
    let line = 1;
    for (let index = 0; index < markdown.length; index += 1) {
      if (markdown[index] === '\n') line += 1;
    }
    return line;
  } catch {
    return 1;
  }
}

// Returns the ProseMirror position that corresponds to the first column of the
// given markdown source line in the current WYSIWYG document. We walk the
// document's top-level blocks, serialising progressively larger prefixes until
// the cumulative markdown line count reaches the target; the cursor is placed
// just inside the first block on (or after) that line.
export function wysiwygPositionAtSourceLine(
  editor: TiptapEditor | null,
  targetLine: number,
): number | null {
  if (!editor) return null;
  if (!Number.isFinite(targetLine) || targetLine < 1) targetLine = 1;
  const serializer = getMarkdownSerializer(editor);
  if (!serializer) return null;

  const doc = editor.state.doc;
  let cumulativeLines = 1;
  // ProseMirror positions: the position immediately INSIDE the first child of
  // the doc is 1. We track the open position so focusing leaves the caret
  // inside that block rather than between blocks (which renders as a no-op).
  let positionAfterPreviousBlocks = 0;
  let candidate: number | null = null;

  try {
    doc.forEach((node, offset) => {
      if (candidate !== null) return;
      const blockOpenPosition = offset + 1; // skip past the opening token
      if (cumulativeLines >= targetLine) {
        candidate = blockOpenPosition;
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
        return;
      }
      cumulativeLines = lines;
      positionAfterPreviousBlocks = sliceEnd;
    });
  } catch {
    return null;
  }

  if (candidate !== null) return candidate;
  // Fall through: the requested line is past the last block — clamp to the
  // end of the document so callers still get a focus-friendly position.
  return Math.max(0, positionAfterPreviousBlocks - 1);
}

type Serializer = {
  serialize: (doc: unknown) => string;
};

function getMarkdownSerializer(editor: TiptapEditor): Serializer | null {
  const storage = editor.storage as unknown as
    | Record<string, unknown>
    | undefined;
  const markdown = storage?.markdown as { serializer?: Serializer } | undefined;
  return markdown?.serializer ?? null;
}
