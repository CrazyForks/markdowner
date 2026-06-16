import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/react';

/** Gap kept between a floating popover and the editor surface edge. */
const DEFAULT_MARGIN_PX = 8;

export type ClampOffset = { dx: number; dy: number };

const NO_OFFSET: ClampOffset = { dx: 0, dy: 0 };

/**
 * The scrollable WYSIWYG editor surface for `editor`. Floating popovers clamp
 * to this rect so they never spill past the visible editor area (where the
 * window edge would otherwise clip them). Derived from the editor's own DOM so
 * it stays correct no matter how many editors are mounted; falls back to the
 * editor content element when the surface wrapper isn't found.
 */
function editorSurfaceRect(editor: Editor | null): DOMRect | null {
  const dom = editor?.view?.dom;
  if (!(dom instanceof HTMLElement)) return null;
  const surface = dom.closest('[data-testid="editor-surface-wysiwyg"]');
  return (surface ?? dom).getBoundingClientRect();
}

/**
 * Delta needed to slide the interval [start, end] inside [min+margin, max-margin].
 * When the popover is wider/taller than the available slot it pins to the low
 * (left/top) edge rather than the high one, keeping its primary content visible.
 */
export function clampAxisDelta(
  start: number,
  end: number,
  min: number,
  max: number,
  margin: number,
): number {
  const lo = min + margin;
  const hi = max - margin;
  if (end - start >= hi - lo) return lo - start; // too big → pin to the low edge
  if (start < lo) return lo - start;
  if (end > hi) return hi - end;
  return 0;
}

/**
 * Keep a portaled popover within the editor surface. Returns a `{dx, dy}` offset
 * to ADD to the popover's computed top/left.
 *
 * Transform-agnostic: it measures the element's real on-screen rect (after any
 * CSS `translate`) and corrects that, so popovers that center themselves with
 * `translate(-50%, …)` clamp correctly. The offset is computed in a layout
 * effect (before paint), so the corrected position is what the user sees — no
 * flash at the unclamped position.
 *
 * `positionDep` should change whenever the base position changes so the clamp
 * re-runs; the popover components already re-render on selection/scroll/resize.
 */
export function useEditorSurfaceClamp(
  editor: Editor | null,
  ref: RefObject<HTMLElement | null>,
  positionDep: unknown,
  margin: number = DEFAULT_MARGIN_PX,
): ClampOffset {
  const appliedRef = useRef<ClampOffset>(NO_OFFSET);
  const [offset, setOffset] = useState<ClampOffset>(NO_OFFSET);

  useLayoutEffect(() => {
    const el = ref.current;
    const bounds = editorSurfaceRect(editor);
    // Degenerate bounds (zero-sized surface — e.g. jsdom, or a not-yet-laid-out
    // editor) carry no usable geometry: leave the popover where it is.
    const measurable =
      el && bounds && bounds.right > bounds.left && bounds.bottom > bounds.top;
    if (!measurable) {
      if (appliedRef.current !== NO_OFFSET) {
        appliedRef.current = NO_OFFSET;
        setOffset(NO_OFFSET);
      }
      return;
    }
    const rect = el.getBoundingClientRect();
    const applied = appliedRef.current;
    // Recover the un-clamped base edges by removing the offset currently applied
    // in the DOM, then compute the correction the base position needs.
    const dx = clampAxisDelta(
      rect.left - applied.dx,
      rect.right - applied.dx,
      bounds.left,
      bounds.right,
      margin,
    );
    const dy = clampAxisDelta(
      rect.top - applied.dy,
      rect.bottom - applied.dy,
      bounds.top,
      bounds.bottom,
      margin,
    );
    if (dx !== applied.dx || dy !== applied.dy) {
      const next = { dx, dy };
      appliedRef.current = next;
      setOffset(next);
    }
  }, [editor, ref, positionDep, margin]);

  return offset;
}
