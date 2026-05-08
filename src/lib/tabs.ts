/**
 * Reorders a list of tabs by moving the tab with `activeId` one position in
 * the given direction. Mirrors VS Code's "Move Editor Left/Right" behavior:
 * the move is a no-op when the active tab is already at the start/end edge
 * (no wrap-around).
 *
 * Returns the original array when there is no move to apply, so callers can
 * use the return value directly with React state setters.
 */
export function moveTab<T extends { id: string }>(
  tabs: readonly T[],
  activeId: string,
  direction: -1 | 1,
): T[] {
  const idx = tabs.findIndex((tab) => tab.id === activeId);
  if (idx < 0) return tabs.slice();
  const target = idx + direction;
  if (target < 0 || target >= tabs.length) return tabs.slice();
  const next = tabs.slice();
  const [moved] = next.splice(idx, 1);
  next.splice(target, 0, moved);
  return next;
}
