/**
 * Browser-style Back/Forward visit trail for document navigation.
 *
 * A single global history of file paths plus a current index. Pure and
 * immutable — every transition returns a new state. The App owns one of these
 * and drives it: `recordNavigation` on every link-follow / file-open (NOT on
 * back/forward itself), `goBack`/`goForward` for the ⌘[ / ⌘] shortcuts and the
 * command palette.
 */
export interface NavigationHistory {
  readonly entries: readonly string[];
  readonly index: number;
}

export function createNavigationHistory(): NavigationHistory {
  return { entries: [], index: -1 };
}

/**
 * Append `path` as the new current entry. Truncates any forward entries (a new
 * navigation after going back discards the forward trail), and ignores empty
 * paths (untitled buffers) and consecutive duplicates of the current entry.
 */
export function recordNavigation(state: NavigationHistory, path: string): NavigationHistory {
  if (!path) return state;
  if (state.index >= 0 && state.entries[state.index] === path) return state;
  const entries = [...state.entries.slice(0, state.index + 1), path];
  return { entries, index: entries.length - 1 };
}

export function canGoBack(state: NavigationHistory): boolean {
  return state.index > 0;
}

export function canGoForward(state: NavigationHistory): boolean {
  return state.index < state.entries.length - 1;
}

export function goBack(
  state: NavigationHistory,
): { state: NavigationHistory; path: string } | null {
  if (!canGoBack(state)) return null;
  const index = state.index - 1;
  return { state: { entries: state.entries, index }, path: state.entries[index] };
}

export function goForward(
  state: NavigationHistory,
): { state: NavigationHistory; path: string } | null {
  if (!canGoForward(state)) return null;
  const index = state.index + 1;
  return { state: { entries: state.entries, index }, path: state.entries[index] };
}
