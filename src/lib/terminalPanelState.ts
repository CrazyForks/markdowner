export const TERMINAL_HEIGHT_KEY = 'markdowner.terminalHeight';
export const TERMINAL_MIN_HEIGHT = 160;
export const TERMINAL_MAX_HEIGHT = 720;
export const TERMINAL_DEFAULT_HEIGHT = 256;
export const TERMINAL_KEYBOARD_STEP = 8;
export const TERMINAL_KEYBOARD_PAGE_STEP = 32;

type TerminalStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function clampTerminalHeight(height: number): number {
  if (!Number.isFinite(height)) return TERMINAL_DEFAULT_HEIGHT;
  return Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, Math.round(height)));
}

export function terminalHeightFromPointerY(
  pointerClientY: number,
  viewportHeight: number,
): number {
  return clampTerminalHeight(viewportHeight - pointerClientY);
}

export function nextTerminalHeightFromKey(currentHeight: number, key: string): number | null {
  switch (key) {
    case 'ArrowUp':
      return clampTerminalHeight(currentHeight + TERMINAL_KEYBOARD_STEP);
    case 'ArrowDown':
      return clampTerminalHeight(currentHeight - TERMINAL_KEYBOARD_STEP);
    case 'PageUp':
      return clampTerminalHeight(currentHeight + TERMINAL_KEYBOARD_PAGE_STEP);
    case 'PageDown':
      return clampTerminalHeight(currentHeight - TERMINAL_KEYBOARD_PAGE_STEP);
    case 'Home':
      return TERMINAL_MIN_HEIGHT;
    case 'End':
      return TERMINAL_MAX_HEIGHT;
    default:
      return null;
  }
}

export function readTerminalHeight(storage = getTerminalStorage()): number {
  try {
    const raw = storage?.getItem(TERMINAL_HEIGHT_KEY);
    if (raw === null || raw === undefined) return TERMINAL_DEFAULT_HEIGHT;
    return clampTerminalHeight(Number.parseInt(raw, 10));
  } catch {
    return TERMINAL_DEFAULT_HEIGHT;
  }
}

export function writeTerminalHeight(height: number, storage = getTerminalStorage()): void {
  try {
    storage?.setItem(TERMINAL_HEIGHT_KEY, String(clampTerminalHeight(height)));
  } catch {
    // localStorage unavailable; ignore
  }
}

function getTerminalStorage(): TerminalStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}
