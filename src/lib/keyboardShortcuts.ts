import type { EditorMode } from './desktop';

type CommandModifierEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>;

type ShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'defaultPrevented' | 'key' | 'shiftKey'>;

type ModeChordEvent = Pick<KeyboardEvent, 'altKey' | 'key' | 'shiftKey'>;

type EditorFontSizeShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'code' | 'shiftKey'>;

export type ModeChordResolution =
  | { kind: 'pendingModifier' }
  | { kind: 'mode'; mode: EditorMode }
  | { kind: 'cancel' };

export type EditorFontSizeShortcutResolution = { kind: 'increase' } | { kind: 'decrease' };

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
