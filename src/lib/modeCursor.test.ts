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

// Map a ProseMirror position to the markdown character offset that the doc
// serializer would emit up to that position. Models the contract production
// relies on: serializer prefix length is monotonically non-decreasing in
// position, blocks join with "\n\n", and only the block-local prefix
// (e.g. "# " for an h1) precedes content.
function markdownLengthAtPosition(blocks: FakeBlock[], pos: number): number {
  let pmCursor = 0;
  let mdOffset = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const blockStart = pmCursor;
    const blockEnd = pmCursor + block.nodeSize;
    const fullMd = block.serialize();
    const prefixLen = fullMd.length - block.textContent.length;
    const separator = i === 0 ? 0 : 2;
    if (pos <= blockStart) return mdOffset;
    if (pos >= blockEnd) {
      mdOffset += separator + fullMd.length;
      pmCursor = blockEnd;
      continue;
    }
    const innerPos = pos - blockStart;
    const contentChars = Math.min(Math.max(0, innerPos - 1), block.textContent.length);
    return mdOffset + separator + prefixLen + contentChars;
  }
  return mdOffset;
}

function buildEditor(
  blocks: FakeBlock[],
  selection:
    | number
    | {
        from: number;
        to?: number;
        head?: number;
      },
) {
  const totalSize = blocks.reduce((sum, b) => sum + b.nodeSize, 0);
  const fullMarkdownLength = markdownLengthAtPosition(blocks, totalSize);
  const doc = {
    content: { size: totalSize },
    forEach(callback: (node: FakeBlock, offset: number) => void) {
      let offset = 0;
      for (const block of blocks) {
        callback(block, offset);
        offset += block.nodeSize;
      }
    },
    cut(from: number, to: number) {
      return { __from: from, __to: to } as unknown as ReturnType<typeof buildEditor>;
    },
  };
  const selectionState =
    typeof selection === 'number'
      ? { from: selection, to: selection, head: selection }
      : {
          from: selection.from,
          to: selection.to ?? selection.from,
          head: selection.head ?? selection.to ?? selection.from,
        };
  return {
    state: {
      doc,
      selection: selectionState,
    },
    storage: {
      markdown: {
        manager: {
          serialize(slice: unknown) {
            if (
              slice &&
              typeof slice === 'object' &&
              '__from' in (slice as Record<string, unknown>) &&
              '__to' in (slice as Record<string, unknown>)
            ) {
              const range = slice as { __from: number; __to: number };
              const start = markdownLengthAtPosition(blocks, range.__from);
              const end = markdownLengthAtPosition(blocks, range.__to);
              return 'x'.repeat(Math.max(0, end - start));
            }
            return 'x'.repeat(fullMarkdownLength);
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

// A simplified structural block — its serialization includes content but the
// markdown prefix per line ("- ") sits between the block-open token and the
// text. The block reports `textContent` matching the full visible markdown so
// the test mock can map PM positions to markdown offsets without modelling
// the full nested listItem/paragraph hierarchy. The point is to exercise the
// "non-paragraph, non-heading" case the previous implementation snapped to
// the block start.
const bulletListTwoItems: FakeBlock = {
  type: { name: 'bulletList' },
  textContent: '- Item 1\n- Item 2',
  nodeSize: '- Item 1\n- Item 2'.length + 2,
  serialize: () => '- Item 1\n- Item 2',
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

  it('uses the active selection head instead of the range start as the cursor', () => {
    const editor = buildEditor([headingHello], { from: 1, to: 7, head: 7 });

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

  it('descends into structural blocks instead of snapping to the block start', () => {
    // Regression: cursors inside lists/blockquotes/code fences used to jump
    // to the block's opening token, because the previous algorithm refused
    // to advance through any block that wasn't a paragraph or heading. The
    // binary search variant walks the serializer's contract directly and
    // lands inside the structural block at the matching markdown offset.
    const editor = buildEditor([bulletListTwoItems], 1);
    // Markdown "- Item 1\n- Item 2" (length 17). Offset 17 (end-of-list)
    // should map to the last valid text position inside the block, not
    // back to its opening token.
    const endPosition = wysiwygPositionAtMarkdownOffset(editor, 17);
    expect(endPosition).toBeGreaterThan(1);
    expect(endPosition).toBe(bulletListTwoItems.nodeSize - 1);
  });
});
