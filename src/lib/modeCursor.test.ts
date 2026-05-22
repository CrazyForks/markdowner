import { describe, expect, it } from 'vitest';

import {
  sourceEditorSelectionForLocation,
  wysiwygCursorMarkdownOffset,
  wysiwygPositionAtMarkdownOffset,
} from './modeCursor';

// Light-weight stand-in for a Tiptap editor. The functions under test only
// reach into `state.selection.from`, `state.doc.cut(from, to).forEach()` /
// `.nodeSize` / `.textContent`, and `storage.markdown.serializer.serialize`,
// so we model just those without dragging in the real ProseMirror machinery.
interface FakeBlock {
  type: { name: string };
  attrs?: { level?: number };
  textContent: string;
  nodeSize: number;
  serialize: () => string;
}

function buildDoc(blocks: FakeBlock[]) {
  const doc = {
    forEach(callback: (node: FakeBlock, offset: number) => void) {
      let offset = 0;
      for (const block of blocks) {
        callback(block, offset);
        offset += block.nodeSize;
      }
    },
    cut(from: number, to: number) {
      // The helpers only need the slice's forEach + serialize-via-serializer
      // semantics. Construct a doc-shaped sub-slice covering the cut range.
      let cursor = 0;
      const subBlocks: FakeBlock[] = [];
      for (const block of blocks) {
        const blockStart = cursor;
        const blockEnd = cursor + block.nodeSize;
        // Either fully or partially inside the cut range — for the
        // partial-prefix case (from = 0, to inside block content), produce
        // a derived block whose serialization is the substring of the
        // block's own serialization.
        if (from <= blockStart && to >= blockEnd) {
          subBlocks.push(block);
        } else if (to > blockStart && to <= blockEnd && from <= blockStart) {
          // Partial: capture the visible text portion of this block.
          const consumed = to - blockStart;
          // For headings/paragraphs the prefix ("## " / "") and text are
          // serialized contiguously; for our test blocks we drive the
          // serializer with the cumulative-length contract directly.
          subBlocks.push({
            ...block,
            nodeSize: consumed,
            serialize: () => block.serialize().slice(0, Math.max(0, consumed - 1)),
          });
        }
        cursor = blockEnd;
      }
      return buildDoc(subBlocks);
    },
  };
  return doc as never;
}

function buildEditor(blocks: FakeBlock[], selectionFrom: number) {
  const doc = buildDoc(blocks);
  return {
    state: {
      doc,
      selection: { from: selectionFrom },
    },
    storage: {
      markdown: {
        serializer: {
          serialize(slice: ReturnType<typeof buildDoc>) {
            const chunks: string[] = [];
            (slice as {
              forEach(cb: (node: FakeBlock, offset: number) => void): void;
            }).forEach((node) => {
              chunks.push(node.serialize());
            });
            // prosemirror-markdown uses closeBlock() to separate top-level
            // blocks with "\n\n". Mirror that here so our offset math
            // matches production.
            return chunks.join('\n\n');
          },
        },
      },
    },
  } as never;
}

const headingHello: FakeBlock = {
  type: { name: 'heading' },
  attrs: { level: 1 },
  textContent: 'Hello',
  nodeSize: 7,
  serialize: () => '# Hello',
};

const paragraphWorld: FakeBlock = {
  type: { name: 'paragraph' },
  textContent: 'World',
  nodeSize: 7,
  serialize: () => 'World',
};

// TrailingNode's typical contribution: an empty paragraph after a heading
// or other non-paragraph block. nodeSize = 2 (open + close tokens, no text).
const trailingEmptyParagraph: FakeBlock = {
  type: { name: 'paragraph' },
  textContent: '',
  nodeSize: 2,
  serialize: () => '',
};

function buildSourceDoc(lines: string[]) {
  const starts: number[] = [];
  let offset = 0;
  lines.forEach((line, index) => {
    starts[index] = offset;
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  });

  return {
    lines: lines.length,
    line(lineNumber: number) {
      const line = lines[lineNumber - 1] ?? '';
      return {
        from: starts[lineNumber - 1] ?? 0,
        length: line.length,
      };
    },
  };
}

describe('sourceEditorSelectionForLocation', () => {
  it('maps a saved source line and column to a collapsed editor selection', () => {
    expect(
      sourceEditorSelectionForLocation(buildSourceDoc(['alpha', 'beta']), {
        line: 2,
        column: 3,
      }),
    ).toEqual({
      anchor: 8,
      head: 8,
    });
  });

  it('clamps invalid or out-of-range source locations inside the document', () => {
    expect(
      sourceEditorSelectionForLocation(buildSourceDoc(['alpha', 'beta']), {
        line: 99,
        column: 99,
      }),
    ).toEqual({
      anchor: 10,
      head: 10,
    });

    expect(
      sourceEditorSelectionForLocation(buildSourceDoc(['alpha']), {
        line: Number.NaN,
        column: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({
      anchor: 0,
      head: 0,
    });
  });
});

describe('wysiwygCursorMarkdownOffset', () => {
  it('returns 0 when the editor is null or the selection sits at the doc start', () => {
    expect(wysiwygCursorMarkdownOffset(null)).toBe(0);
    expect(wysiwygCursorMarkdownOffset(buildEditor([headingHello], 0))).toBe(0);
  });

  it('measures the serialized markdown length up to the cursor', () => {
    // Cursor after the "H" inside the heading — slice serializes to "# Hello"
    // minus one char from the end, given our fake serializer driver.
    const editor = buildEditor([headingHello], 7);
    expect(wysiwygCursorMarkdownOffset(editor)).toBe('# Hello'.length);
  });
});

describe('wysiwygPositionAtMarkdownOffset', () => {
  it('lands at offset 0 for non-positive targets', () => {
    const editor = buildEditor([headingHello, paragraphWorld], 1);
    expect(wysiwygPositionAtMarkdownOffset(editor, -1)).toBe(0);
    expect(wysiwygPositionAtMarkdownOffset(editor, 0)).toBe(0);
  });

  it('lands inside the first block when the target falls before the next block', () => {
    const editor = buildEditor([headingHello, paragraphWorld], 1);
    // "# Hello".length === 7 → target 4 sits inside the heading. The heading
    // prefix is "# " (length 2), so the residual advance is 4 - 2 = 2 chars
    // into "Hello".
    expect(wysiwygPositionAtMarkdownOffset(editor, 4)).toBe(1 + 2);
  });

  it('lands at the start of the second block when the target falls inside the block separator', () => {
    const editor = buildEditor([headingHello, paragraphWorld], 1);
    // "# Hello".length is 7; the inter-block "\n\n" runs through offset 9.
    // Targeting offset 8 (mid-separator) should collapse to the start of
    // the paragraph (ProseMirror position = headingHello.nodeSize + 1 = 8).
    expect(wysiwygPositionAtMarkdownOffset(editor, 8)).toBe(8);
  });

  it('lands at the trailing empty paragraph for offsets that match the doc end after TrailingNode', () => {
    // The user-reported scenario: WYSIWYG appends an empty paragraph after a
    // heading, producing markdown "# Hello\n\n" (length 9). Source mode
    // serializes to "# Hello\n" (length 8). Mapping the source-end offset
    // (8) into WYSIWYG should land inside the trailing empty paragraph
    // rather than landing at heading's last char.
    const editor = buildEditor([headingHello, trailingEmptyParagraph], 1);
    // Block separator (\n\n) brackets offsets 7..9 between the two blocks;
    // the trailing paragraph's own serialization is empty. Offset 8 falls
    // inside the separator → position = trailingEmptyParagraph's open
    // position (headingHello.nodeSize + 1 = 8).
    expect(wysiwygPositionAtMarkdownOffset(editor, 8)).toBe(8);
  });

  it('lands at the last valid position for offsets past the doc end', () => {
    const editor = buildEditor([headingHello, paragraphWorld], 1);
    // Total serialized length is "# Hello\n\nWorld".length === 14. Asking
    // for a position past that should clamp to the last valid text spot,
    // which is positionAfterPreviousBlocks - 1.
    expect(wysiwygPositionAtMarkdownOffset(editor, 9999)).toBe(
      headingHello.nodeSize + paragraphWorld.nodeSize - 1,
    );
  });
});
