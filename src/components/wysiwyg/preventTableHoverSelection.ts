import { Extension } from '@tiptap/core';
import { CellSelection, tableEditingKey } from '@tiptap/pm/tables';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

const pluginKey = new PluginKey('preventTableHoverSelection');

/** A click that moves less than this (px) between down and up is a click, not a drag. */
const CLICK_MOVEMENT_THRESHOLD_PX = 4;

/**
 * Robust table pointer interaction. Solves two related bugs that only
 * surfaced in Tauri's WebKit engine:
 *
 * 1. "cell이 드래그하지 않아도 자동으로 드래그되는" — on mousedown
 *    prosemirror-tables attaches its OWN mousemove/mouseup listeners to
 *    `view.root` (the document) and extends a CellSelection on every mousemove
 *    while `tableEditingKey` state is active. If the terminating mouseup is
 *    missed (pointer leaves the window, drag ends outside the editor, focus
 *    loss — frequent in Tauri's WebKit) that state goes stale and every later
 *    HOVER grows the selection. Swallowing the mousemove via handleDOMEvents
 *    cannot help: that document-level listener fires regardless. Instead we
 *    track the real primary-button state (pointerdown/up/cancel + window blur)
 *    and, when a mousemove arrives with the button up but a drag still active,
 *    trigger prosemirror-tables' own teardown by dispatching a mouseup to
 *    `view.root` — removing its move listener and clearing the stale state.
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
            mousemove(view, event) {
              // A real drag (button held) must pass through untouched so
              // deliberate multi-cell selection works exactly like Chrome.
              if (primaryButtonDown) return false;
              // Button is up. If prosemirror-tables still has an active cell
              // drag, its terminating mouseup was missed and this hover would
              // otherwise extend the selection. Tear the drag down using its
              // own stop() handler (listening for mouseup on view.root): this
              // removes the document-level move listener and clears the state.
              // This handler runs on view.dom, which is inside view.root, so it
              // fires BEFORE the stale move listener for this same event —
              // the selection never grows. No-op for a clean hover (no drag),
              // so column-resize hover detection keeps working.
              if (tableEditingKey.getState(view.state) == null) return false;
              const root = view.root as unknown as EventTarget & {
                dispatchEvent: (event: Event) => boolean;
              };
              root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              return true;
            },
          },
        },
      }),
    ];
  },
});
