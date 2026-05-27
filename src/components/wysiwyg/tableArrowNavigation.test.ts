/**
 * Tests for deterministic table row navigation. Boots a real Tiptap editor
 * with a table and drives the ArrowDown/ArrowUp shortcuts.
 *
 * NOTE: `view.endOfTextblock()` depends on real layout that jsdom doesn't
 * provide, so we stub it to isolate the column-preserving move logic (the
 * part that was actually broken in WebKit). The edge-gating itself is
 * verified manually in a real browser.
 */
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import StarterKit from '@tiptap/starter-kit';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TableArrowNavigation } from './tableArrowNavigation';

function buildEditor(): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TableArrowNavigation,
    ],
    content: '<p>x</p>',
  });
}

/** Row-major cell start positions. */
function cellPositions(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') out.push(pos);
    return true;
  });
  return out;
}

function cellIndexOf(editor: Editor, pos: number): number {
  const cells = cellPositions(editor);
  for (let i = 0; i < cells.length; i += 1) {
    const next = cells[i + 1] ?? Infinity;
    if (pos > cells[i] && pos < next) return i;
  }
  return -1;
}

describe('TableArrowNavigation', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = buildEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    // jsdom has no layout; force endOfTextblock so the navigation logic runs.
    vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
  });

  afterEach(() => {
    const el = editor.view.dom.parentElement;
    editor.destroy();
    el?.remove();
  });

  it('ArrowDown moves to the cell directly below in the same column (not right)', () => {
    const cells = cellPositions(editor);
    // Cursor in row0,col0.
    editor.chain().focus().setTextSelection(cells[0] + 1).run();
    const handled = editor.view.someProp('handleKeyDown', (fn) =>
      fn?.(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    );
    expect(handled).toBe(true);
    // row1,col0 is cell index 3 in a 3-col table.
    expect(cellIndexOf(editor, editor.state.selection.from)).toBe(3);
  });

  it('ArrowUp moves to the cell directly above in the same column', () => {
    const cells = cellPositions(editor);
    // Cursor in row1,col1 (index 4).
    editor.chain().focus().setTextSelection(cells[4] + 1).run();
    const handled = editor.view.someProp('handleKeyDown', (fn) =>
      fn?.(editor.view, new KeyboardEvent('keydown', { key: 'ArrowUp' })),
    );
    expect(handled).toBe(true);
    // row0,col1 is cell index 1.
    expect(cellIndexOf(editor, editor.state.selection.from)).toBe(1);
  });

  it('ArrowDown from the last row lets the default handler run (returns false)', () => {
    const cells = cellPositions(editor);
    // Cursor in row2,col0 (index 6) — bottom row.
    editor.chain().focus().setTextSelection(cells[6] + 1).run();
    const handled = editor.view.someProp('handleKeyDown', (fn) =>
      fn?.(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    );
    expect(handled).toBeFalsy();
  });

  it('does nothing outside a table', () => {
    editor.commands.setContent('<p>plain paragraph</p>');
    editor.chain().focus().setTextSelection(3).run();
    vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
    const handled = editor.view.someProp('handleKeyDown', (fn) =>
      fn?.(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    );
    expect(handled).toBeFalsy();
  });
});
