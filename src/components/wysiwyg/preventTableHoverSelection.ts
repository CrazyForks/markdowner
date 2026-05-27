import { Extension } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

const pluginKey = new PluginKey('preventTableHoverSelection');

/** A click that moves less than this (px) between down and up is a click, not a drag. */
const CLICK_MOVEMENT_THRESHOLD_PX = 4;

/**
 * Robust table pointer interaction. Solves two related bugs that only
 * surfaced in Tauri's WebKit engine:
 *
 * 1. "cell이 드래그하지 않아도 자동으로 드래그되는" — prosemirror-tables
 *    extends a CellSelection on mousemove while it thinks a drag is in
 *    progress. If the terminating mouseup is missed (pointer leaves the
 *    window, drag ends outside the editor, focus loss) its drag state goes
 *    stale and every later hover grows the selection. The earlier guard used
 *    `MouseEvent.buttons`, but WebKit reports a STALE buttons value after
 *    drags, so the guard leaked. We track the real primary-button state from
 *    pointerdown/up/cancel (+ window blur) and swallow idle in-table
 *    mousemoves whenever the button is up.
 *
 * 2. A click that incidentally produces a single-cell CellSelection (which
 *    paints the whole cell as "selected" and makes the column/row-add buttons
 *    operate on the wrong target) is collapsed back to a plain text caret on
 *    pointerup — but only for clicks (small movement), so deliberate drag
 *    selections survive. This runs on pointerup, never during typing, so it
 *    can't interfere with CJK composition the way a per-transaction
 *    normaliser did.
 */
export const PreventTableHoverSelection = Extension.create({
  name: 'preventTableHoverSelection',

  addProseMirrorPlugins() {
    let primaryButtonDown = false;
    let downX = 0;
    let downY = 0;

    return [
      new Plugin({
        key: pluginKey,
        view(editorView) {
          const ownerDocument = editorView.dom.ownerDocument;
          const win = ownerDocument.defaultView ?? window;

          const onPointerDown = (event: PointerEvent | MouseEvent) => {
            if (event.button !== 0) return;
            primaryButtonDown = true;
            downX = event.clientX;
            downY = event.clientY;
          };

          // Latch on BOTH pointerdown and mousedown. Real browsers fire
          // pointerdown→mousedown for a mouse press, but we must not depend on
          // pointer events being present (some environments/synthetic input
          // emit only mouse events); if the latch never set, we'd wrongly
          // swallow the drag's mousemoves and cell-drag-selection would break.

          const collapseAccidentalCellSelection = (clientX: number, clientY: number) => {
            const distance = Math.hypot(clientX - downX, clientY - downY);
            // A real drag (moved past the threshold) keeps its multi-cell
            // selection; only a click collapses.
            if (distance >= CLICK_MOVEMENT_THRESHOLD_PX) return;
            // Defer one frame so prosemirror-tables finishes its own mouseup
            // bookkeeping before we (maybe) override the selection.
            win.requestAnimationFrame(() => {
              const { selection, doc, tr } = editorView.state;
              if (!(selection instanceof CellSelection)) return;
              // Preserve genuine multi-cell selections.
              if (selection.$anchorCell.pos !== selection.$headCell.pos) return;
              const inside = Math.min(selection.$headCell.pos + 1, doc.content.size);
              editorView.dispatch(
                tr.setSelection(TextSelection.near(doc.resolve(inside))),
              );
            });
          };

          const onPointerUp = (event: PointerEvent | MouseEvent) => {
            const wasDown = primaryButtonDown;
            primaryButtonDown = false;
            if (!wasDown) return;
            collapseAccidentalCellSelection(event.clientX, event.clientY);
          };

          const releaseOnly = () => {
            primaryButtonDown = false;
          };

          ownerDocument.addEventListener('pointerdown', onPointerDown, true);
          ownerDocument.addEventListener('mousedown', onPointerDown, true);
          ownerDocument.addEventListener('pointerup', onPointerUp, true);
          ownerDocument.addEventListener('pointercancel', releaseOnly, true);
          ownerDocument.addEventListener('mouseup', onPointerUp, true);
          win.addEventListener('blur', releaseOnly);

          return {
            destroy() {
              ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
              ownerDocument.removeEventListener('mousedown', onPointerDown, true);
              ownerDocument.removeEventListener('pointerup', onPointerUp, true);
              ownerDocument.removeEventListener('pointercancel', releaseOnly, true);
              ownerDocument.removeEventListener('mouseup', onPointerUp, true);
              win.removeEventListener('blur', releaseOnly);
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(_view, event) {
              if (primaryButtonDown) return false;
              const target = (event as MouseEvent).target as HTMLElement | null;
              if (target && target.closest('table')) {
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
