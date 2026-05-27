import { Extension } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';

interface CellContext {
  cellPosBefore: number;
  tableNode: import('@tiptap/pm/model').Node;
  tableContentStart: number;
}

/** Walk up from a position to the enclosing cell + its table. */
function findCellContext($pos: ResolvedPos): CellContext | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') {
      for (let tableDepth = depth - 1; tableDepth > 0; tableDepth -= 1) {
        if ($pos.node(tableDepth).type.spec.tableRole === 'table') {
          return {
            cellPosBefore: $pos.before(depth),
            tableNode: $pos.node(tableDepth),
            // Position just inside the table node — the origin TableMap
            // positions are measured from.
            tableContentStart: $pos.before(tableDepth) + 1,
          };
        }
      }
      return null;
    }
  }
  return null;
}

/**
 * Move the caret to the cell directly above / below in the SAME column.
 *
 * prosemirror-tables ships horizontal Tab/Shift-Tab navigation but leaves
 * vertical Up/Down to the browser's native caret movement. WebKit (Tauri's
 * engine) frequently moves the caret to the wrong cell — e.g. ArrowDown from
 * the top-left cell lands one cell to the RIGHT instead of below ("down
 * arrow를 누르면 오른쪽 셀로 이동"). We replace that with a deterministic
 * column-preserving move computed from the TableMap, so colspan/rowspan
 * tables behave correctly too.
 *
 * We only intercept when the caret is already at the visual top/bottom edge
 * of its textblock (via `endOfTextblock`), so multi-line cell content still
 * navigates line-by-line inside the cell first. When there is no row in the
 * target direction we return false and let ProseMirror's default handler run
 * (which steps out of the table).
 */
function moveByRow(view: EditorView, direction: 1 | -1): boolean {
  const { state } = view;
  const { selection } = state;
  if (!selection.empty) return false;

  const $from = selection.$from;
  const ctx = findCellContext($from);
  if (!ctx) return false;

  const atEdge =
    direction > 0 ? view.endOfTextblock('down') : view.endOfTextblock('up');
  if (!atEdge) return false;

  let map: TableMap;
  try {
    map = TableMap.get(ctx.tableNode);
  } catch {
    return false;
  }

  const cellRel = ctx.cellPosBefore - ctx.tableContentStart;
  let rect: { left: number; top: number; right: number; bottom: number };
  try {
    rect = map.findCell(cellRel);
  } catch {
    return false;
  }

  const targetRow = direction > 0 ? rect.bottom : rect.top - 1;
  if (targetRow < 0 || targetRow >= map.height) {
    // No row in that direction — let the default handler step out of the
    // table.
    return false;
  }

  let targetCellRel: number;
  try {
    targetCellRel = map.positionAt(targetRow, rect.left, ctx.tableNode);
  } catch {
    return false;
  }

  const targetCellAbs = ctx.tableContentStart + targetCellRel;
  // `targetCellAbs` is the position of the target cell node; +1 lands inside
  // its first child (the cell's paragraph).
  const inside = targetCellAbs + 1;
  const docSize = state.doc.content.size;
  if (inside < 0 || inside > docSize) return false;

  const tr = state.tr.setSelection(
    TextSelection.near(state.doc.resolve(Math.min(inside, docSize))),
  );
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const TableArrowNavigation = Extension.create({
  name: 'tableArrowNavigation',

  addKeyboardShortcuts() {
    return {
      ArrowDown: ({ editor }) => moveByRow(editor.view, 1),
      ArrowUp: ({ editor }) => moveByRow(editor.view, -1),
    };
  },
});

export default TableArrowNavigation;
