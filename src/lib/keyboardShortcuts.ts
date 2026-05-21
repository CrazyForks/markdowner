import type { EditorMode } from './desktop';

type CommandModifierEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>;

type ShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'defaultPrevented' | 'key' | 'shiftKey'>;

type ModeChordEvent = Pick<KeyboardEvent, 'altKey' | 'key' | 'shiftKey'>;

type EditorFontSizeShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'code' | 'shiftKey'>;

type TabShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'key' | 'shiftKey'>;

type ModeNumberShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'code' | 'shiftKey'>;

type FocusToggleShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'key' | 'shiftKey'>;

type FocusToggleContext = {
  isSidebarOpen: boolean;
  sidebarPanel: 'files' | 'outline' | 'search';
  focusInsideExplorer: boolean;
};

export type ModeChordResolution =
  | { kind: 'pendingModifier' }
  | { kind: 'mode'; mode: EditorMode }
  | { kind: 'cancel' };

export type EditorFontSizeShortcutResolution = { kind: 'increase' } | { kind: 'decrease' };

export type TabShortcutResolution =
  | { kind: 'selectNext' }
  | { kind: 'selectPrevious' }
  | { kind: 'selectIndex'; index: number }
  | { kind: 'moveActive'; direction: -1 | 1 };

export type ModeNumberShortcutResolution = { kind: 'mode'; mode: EditorMode };

export type FocusToggleShortcutResolution =
  | { kind: 'focusOutline' }
  | { kind: 'focusEditor' }
  | { kind: 'showExplorer' };

export function usesCommandModifier(event: CommandModifierEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function matchesShortcut(
  event: ShortcutEvent,
  key: string,
  options: { shift?: boolean } = {},
): boolean {
  if (event.defaultPrevented || event.altKey || !usesCommandModifier(event)) {
    return false;
  }

  return event.key.toLowerCase() === key && event.shiftKey === (options.shift ?? false);
}

export function resolveModeChord(event: ModeChordEvent): ModeChordResolution {
  const key = event.key.toLowerCase();
  if (key === 'meta' || key === 'control' || key === 'shift' || key === 'alt') {
    return { kind: 'pendingModifier' };
  }
  if (event.altKey || event.shiftKey) {
    return { kind: 'cancel' };
  }

  switch (key) {
    case 'w':
      return { kind: 'mode', mode: 'Wysiwyg' };
    case 'e':
      return { kind: 'mode', mode: 'Editor' };
    case 's':
      return { kind: 'mode', mode: 'SplitView' };
    default:
      return { kind: 'cancel' };
  }
}

export function resolveEditorFontSizeShortcut(
  event: EditorFontSizeShortcutEvent,
): EditorFontSizeShortcutResolution | null {
  if (!usesCommandModifier(event) || event.altKey) {
    return null;
  }
  if (event.code === 'Equal') {
    return { kind: 'increase' };
  }
  if (event.code === 'Minus' && !event.shiftKey) {
    return { kind: 'decrease' };
  }
  return null;
}

export function resolveTabShortcut(event: TabShortcutEvent): TabShortcutResolution | null {
  if (usesCommandModifier(event) && event.shiftKey && !event.altKey) {
    if (event.key === ']' || event.key === '}') {
      return { kind: 'selectNext' };
    }
    if (event.key === '[' || event.key === '{') {
      return { kind: 'selectPrevious' };
    }
  }

  if (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === 'PageUp' || event.key === 'PageDown')
  ) {
    return {
      kind: 'moveActive',
      direction: event.key === 'PageDown' ? 1 : -1,
    };
  }

  if (
    event.key.length === 1 &&
    /[1-9]/.test(event.key) &&
    usesCommandModifier(event) &&
    !event.shiftKey &&
    !event.altKey
  ) {
    return {
      kind: 'selectIndex',
      index: Number.parseInt(event.key, 10) - 1,
    };
  }

  return null;
}

export function resolveModeNumberShortcut(
  event: ModeNumberShortcutEvent,
): ModeNumberShortcutResolution | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
    return null;
  }

  switch (event.code) {
    case 'Digit1':
      return { kind: 'mode', mode: 'Wysiwyg' };
    case 'Digit2':
      return { kind: 'mode', mode: 'Editor' };
    case 'Digit3':
      return { kind: 'mode', mode: 'SplitView' };
    default:
      return null;
  }
}

export function resolveFocusToggleShortcut(
  event: FocusToggleShortcutEvent,
  context: FocusToggleContext,
): FocusToggleShortcutResolution | null {
  if (event.key !== '0' || !usesCommandModifier(event) || event.shiftKey || event.altKey) {
    return null;
  }
  if (context.isSidebarOpen && context.sidebarPanel === 'outline') {
    return { kind: 'focusOutline' };
  }
  if (context.focusInsideExplorer) {
    return { kind: 'focusEditor' };
  }
  return { kind: 'showExplorer' };
}
