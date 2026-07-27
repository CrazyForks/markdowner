/**
 * Geometry for pointer-driven tab reordering.
 *
 * The tab strip measures its tabs once when a drag begins and then only paints
 * CSS transforms until the pointer is released. Nothing about the rendered array
 * changes mid-drag, so the drag source's DOM node stays put — which is what makes
 * the interaction survive WebKit and lets neighbours animate into place.
 */

/** One tab's horizontal box, in tab-strip *content* coordinates. */
export interface TabSlot {
  id: string;
  left: number;
  width: number;
}

export interface TabDragPlacement {
  /** Index the dragged tab would take if the pointer were released now. */
  index: number;
  /** Pixel offset to paint on each slot, parallel to the `slots` argument. */
  offsets: number[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Resolves where a dragged tab sits and how far every tab has to slide out of its
 * way.
 *
 * A tab claims the next slot once its leading edge passes that neighbour's
 * *displayed* centre — the half-overlap rule browsers use for their own tab
 * strips. Because the forward and backward thresholds are the same point, the
 * result depends only on the pointer position: a pointer resting on a boundary
 * cannot flip-flop between two placements.
 *
 * @param slots Tabs in render order, measured at drag start.
 * @param sourceIndex Index of the dragged tab within `slots`.
 * @param pointerContentX Pointer x in strip content coordinates.
 * @param grabOffsetX How far into the dragged tab the pointer grabbed it.
 */
export function planTabDragPlacement(
  slots: readonly TabSlot[],
  sourceIndex: number,
  pointerContentX: number,
  grabOffsetX: number,
): TabDragPlacement {
  const offsets = slots.map(() => 0);
  const source = slots[sourceIndex];
  if (!source) return { index: sourceIndex, offsets };

  const stripStart = slots[0].left;
  const last = slots[slots.length - 1];
  const stripEnd = last.left + last.width;
  const draggedLeft = clamp(
    pointerContentX - grabOffsetX,
    stripStart,
    Math.max(stripStart, stripEnd - source.width),
  );
  offsets[sourceIndex] = draggedLeft - source.left;

  // Walk the strip as it would look with the dragged tab lifted out of it, and
  // count the tabs the dragged tab's leading edge has already cleared.
  let index = 0;
  let slotLeft = stripStart;
  for (let i = 0; i < slots.length; i += 1) {
    if (i === sourceIndex) continue;
    const width = slots[i].width;
    if (draggedLeft <= slotLeft + width / 2) break;
    index += 1;
    slotLeft += width;
  }

  // Everything between the old and the new index gives up exactly the dragged
  // tab's width, in the direction it came from.
  if (index > sourceIndex) {
    for (let i = sourceIndex + 1; i <= index; i += 1) offsets[i] = -source.width;
  } else if (index < sourceIndex) {
    for (let i = index; i < sourceIndex; i += 1) offsets[i] = source.width;
  }

  return { index, offsets };
}

/**
 * Moves the tab with `sourceId` to `index`, clamping the index into range.
 *
 * Returns a fresh copy even when the move is a no-op (unknown id, same index) so
 * callers can hand the result straight to a state setter.
 */
export function moveTabToIndex<T extends { id: string }>(
  tabs: readonly T[],
  sourceId: string,
  index: number,
): T[] {
  const next = tabs.slice();
  const from = next.findIndex((tab) => tab.id === sourceId);
  if (from < 0) return next;

  const [moved] = next.splice(from, 1);
  next.splice(clamp(index, 0, next.length), 0, moved);
  return next;
}
