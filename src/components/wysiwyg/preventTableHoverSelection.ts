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
    // Re-entrancy guard: forceTableDragTeardown dispatches a synthetic mouseup,
    // which our own release listeners would otherwise re-process (and re-tear-
    // down) forever.
    let tearingDown = false;

    type ViewLike = {
      root: { dispatchEvent: (event: Event) => boolean };
    };

    // The actual fix. prosemirror-tables attaches its drag mousemove/mouseup
    // listeners to view.root on mousedown and only removes them when a `mouseup`
    // fires on view.root. Tauri's WebKit frequently DROPS that mouseup (the real
    // mouseup never reaches view.root), so the drag's mousemove listener lingers
    // and every later hover extends the selection — and because it never checks
    // event.buttons, it does so with no button held. `pointerup` IS delivered
    // reliably, so on every release we synthesize the mouseup prosemirror missed,
    // forcing its stop() to run and detach the lingering listener.
    const forceTableDragTeardown = (view: ViewLike) => {
      if (tearingDown) return;
      tearingDown = true;
      try {
        view.root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      } finally {
        tearingDown = false;
      }
    };

    const primaryButtonIsUp = (event: MouseEvent) =>
      !primaryButtonDown || (event.buttons & 1) === 0;

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
              const cellStart = selection.$headCell.pos;
              const cellEnd = cellStart + (selection.$headCell.nodeAfter?.nodeSize ?? 2);
              // Collapse to the CLICKED character, not the cell start —
              // landing at the start of a filled cell reads as a caret jump.
              // posAtCoords needs real layout (caretRangeFromPoint), which
              // jsdom lacks, so fall back to the cell start on any failure
              // and reject hits that resolve outside the clicked cell
              // (releases over padding/borders can land in a neighbour).
              let inside = Math.min(cellStart + 1, doc.content.size);
              try {
                const hit = editorView.posAtCoords({ left: clientX, top: clientY });
                if (hit && hit.pos > cellStart && hit.pos < cellEnd) {
                  inside = hit.pos;
                }
              } catch {
                // Keep the cell-start fallback.
              }
              editorView.dispatch(
                tr.setSelection(TextSelection.near(doc.resolve(inside))),
              );
            });
          };

          const onRelease = (event: PointerEvent | MouseEvent) => {
            // Ignore the synthetic mouseup we dispatch during teardown.
            if (tearingDown) return;
            const wasDown = primaryButtonDown;
            primaryButtonDown = false;
            // Always force the drag teardown on release — even if prosemirror's
            // own mouseup arrived, this is idempotent (stop() removes already-
            // removed listeners harmlessly).
            forceTableDragTeardown(editorView);
            if (wasDown) collapseAccidentalCellSelection(event.clientX, event.clientY);
          };

          const onCancel = () => {
            if (tearingDown) return;
            primaryButtonDown = false;
            forceTableDragTeardown(editorView);
          };

          const onDocumentMouseMove = (event: MouseEvent) => {
            // prosemirror-tables listens for drag mousemove on view.root
            // (document), so a stale drag can still mutate the selection while
            // the cursor is travelling over portal chrome such as the floating
            // table toolbar. handleDOMEvents only sees moves whose target is
            // inside editorView.dom; this capture listener closes the gap.
            if (!primaryButtonIsUp(event)) return;
            if (tableEditingKey.getState(editorView.state) == null) return;
            primaryButtonDown = false;
            forceTableDragTeardown(editorView);
            event.stopPropagation();
          };

          ownerDocument.addEventListener('pointerdown', onPointerDown, true);
          ownerDocument.addEventListener('mousedown', onPointerDown, true);
          ownerDocument.addEventListener('mousemove', onDocumentMouseMove, true);
          ownerDocument.addEventListener('pointerup', onRelease, true);
          ownerDocument.addEventListener('pointercancel', onCancel, true);
          ownerDocument.addEventListener('mouseup', onRelease, true);
          win.addEventListener('blur', onCancel);

          return {
            destroy() {
              ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
              ownerDocument.removeEventListener('mousedown', onPointerDown, true);
              ownerDocument.removeEventListener('mousemove', onDocumentMouseMove, true);
              ownerDocument.removeEventListener('pointerup', onRelease, true);
              ownerDocument.removeEventListener('pointercancel', onCancel, true);
              ownerDocument.removeEventListener('mouseup', onRelease, true);
              win.removeEventListener('blur', onCancel);
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              // Safety net for the case where BOTH pointerup and mouseup were
              // dropped, leaving the button latch stuck. Use the mousemove's own
              // `buttons` (reliably 0 on a true hover) as a second release
              // signal: if nothing is pressed but a table drag is still active,
              // it can only be a stale drag — tear it down and swallow this move
              // so it can't extend first. No-op during a genuine drag (button
              // held) and for clean hovers (no active drag), so column-resize
              // hover detection is unaffected.
              const buttonUp = primaryButtonIsUp(event as MouseEvent);
              if (!buttonUp) return false;
              if (tableEditingKey.getState(view.state) == null) return false;
              forceTableDragTeardown(view);
              return true;
            },
          },
        },
      }),
    ];
  },
});
