/**
 * Tests for the PreventTableHoverSelection plugin — the engine-robust guard
 * against prosemirror-tables' stale cell-selection "auto-drag" and accidental
 * single-cell selections. Drives a real Tiptap editor + table so the plugin's
 * pointer tracking and ProseMirror selection logic run for real.
 */
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import StarterKit from '@tiptap/starter-kit';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PreventTableHoverSelection } from './preventTableHoverSelection';

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
      PreventTableHoverSelection,
    ],
    content: '<p>x</p>',
  });
}

function cellPositions(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') out.push(pos);
    return true;
  });
  return out;
}

describe('PreventTableHoverSelection', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = buildEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  });

  afterEach(() => {
    const el = editor.view.dom.parentElement;
    editor.destroy();
    el?.remove();
  });

  it('swallows idle (no-button) mousemove inside a table', () => {
    const td = editor.view.dom.querySelector('td, th') as HTMLElement;
    expect(td).toBeTruthy();
    // No pointerdown happened, so the primary button is considered up.
    const handled = editor.view.someProp('handleDOMEvents', (handlers: any) =>
      handlers?.mousemove?.(editor.view, { target: td } as unknown as MouseEvent),
    );
    expect(handled).toBe(true);
  });

  it('lets mousemove through while the primary button is genuinely held', () => {
    const td = editor.view.dom.querySelector('td, th') as HTMLElement;
    // Simulate a real press: pointerdown with button 0 latches the state.
    document.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, bubbles: true }),
    );
    const handled = editor.view.someProp('handleDOMEvents', (handlers: any) =>
      handlers?.mousemove?.(editor.view, { target: td } as unknown as MouseEvent),
    );
    expect(handled).toBeFalsy();
    // Release for cleanliness.
    document.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }));
  });

  it('does not swallow mousemove outside a table', () => {
    const handled = editor.view.someProp('handleDOMEvents', (handlers: any) =>
      handlers?.mousemove?.(editor.view, {
        target: document.body,
      } as unknown as MouseEvent),
    );
    expect(handled).toBeFalsy();
  });

  it('collapses a single-cell CellSelection to a text caret on a click (small movement)', async () => {
    const cells = cellPositions(editor);
    // Force a single-cell CellSelection on the first cell.
    const $cell = editor.state.doc.resolve(cells[0]);
    editor.view.dispatch(
      editor.state.tr.setSelection(new CellSelection($cell)),
    );
    expect(editor.state.selection instanceof CellSelection).toBe(true);

    // Simulate a click: pointerdown then pointerup at (nearly) the same point.
    document.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 50, clientY: 50, bubbles: true }),
    );
    document.dispatchEvent(
      new MouseEvent('pointerup', { button: 0, clientX: 51, clientY: 50, bubbles: true }),
    );

    // The collapse is deferred a frame.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));

    expect(editor.state.selection instanceof CellSelection).toBe(false);
  });

  it('preserves a multi-cell CellSelection after a real drag (large movement)', async () => {
    const cells = cellPositions(editor);
    // Multi-cell selection: first cell to a different cell.
    const $anchor = editor.state.doc.resolve(cells[0]);
    const $head = editor.state.doc.resolve(cells[1]);
    editor.view.dispatch(
      editor.state.tr.setSelection(new CellSelection($anchor, $head)),
    );
    expect(editor.state.selection instanceof CellSelection).toBe(true);

    // Simulate a drag: pointerdown then pointerup far away.
    document.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 50, clientY: 50, bubbles: true }),
    );
    document.dispatchEvent(
      new MouseEvent('pointerup', { button: 0, clientX: 300, clientY: 50, bubbles: true }),
    );

    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));

    // Multi-cell selection survives a genuine drag.
    expect(editor.state.selection instanceof CellSelection).toBe(true);
  });
});
