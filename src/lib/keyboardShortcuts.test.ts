import { describe, expect, it } from 'vitest';

import {
  matchesShortcut,
  resolveEditorFontSizeShortcut,
  resolveModeChord,
  usesCommandModifier,
} from './keyboardShortcuts';

function shortcutEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: 'x',
    metaKey: false,
    shiftKey: false,
    code: 'KeyX',
    ...overrides,
  } as KeyboardEvent;
}

describe('usesCommandModifier', () => {
  it('accepts either platform command modifier', () => {
    expect(usesCommandModifier(shortcutEvent({ metaKey: true }))).toBe(true);
    expect(usesCommandModifier(shortcutEvent({ ctrlKey: true }))).toBe(true);
    expect(usesCommandModifier(shortcutEvent())).toBe(false);
  });
});

describe('matchesShortcut', () => {
  it('matches command-modified keys case-insensitively', () => {
    expect(matchesShortcut(shortcutEvent({ key: 'F', metaKey: true }), 'f')).toBe(true);
    expect(matchesShortcut(shortcutEvent({ key: 'f', ctrlKey: true }), 'f')).toBe(true);
  });

  it('rejects alt-modified or already-prevented events', () => {
    expect(matchesShortcut(shortcutEvent({ key: 'f', metaKey: true, altKey: true }), 'f')).toBe(
      false,
    );
    expect(
      matchesShortcut(shortcutEvent({ key: 'f', metaKey: true, defaultPrevented: true }), 'f'),
    ).toBe(false);
  });

  it('requires the requested shift state exactly', () => {
    expect(matchesShortcut(shortcutEvent({ key: 'f', metaKey: true, shiftKey: true }), 'f')).toBe(
      false,
    );
    expect(
      matchesShortcut(shortcutEvent({ key: 'f', metaKey: true, shiftKey: true }), 'f', {
        shift: true,
      }),
    ).toBe(true);
  });
});

describe('resolveModeChord', () => {
  it.each([
    ['w', 'Wysiwyg'],
    ['E', 'Editor'],
    ['s', 'SplitView'],
  ] as const)('maps %s to %s mode', (key, mode) => {
    expect(resolveModeChord(shortcutEvent({ key }))).toEqual({ kind: 'mode', mode });
  });

  it('keeps the chord pending while only modifier keys are pressed', () => {
    expect(resolveModeChord(shortcutEvent({ key: 'Meta' }))).toEqual({
      kind: 'pendingModifier',
    });
    expect(resolveModeChord(shortcutEvent({ key: 'Control' }))).toEqual({
      kind: 'pendingModifier',
    });
  });

  it('cancels unknown or shifted chord completions', () => {
    expect(resolveModeChord(shortcutEvent({ key: 'x' }))).toEqual({ kind: 'cancel' });
    expect(resolveModeChord(shortcutEvent({ key: 'w', shiftKey: true }))).toEqual({
      kind: 'cancel',
    });
    expect(resolveModeChord(shortcutEvent({ key: 'w', altKey: true }))).toEqual({
      kind: 'cancel',
    });
  });
});

describe('resolveEditorFontSizeShortcut', () => {
  it.each([
    [{ code: 'Equal', metaKey: true }, 'increase'],
    [{ code: 'Equal', metaKey: true, shiftKey: true }, 'increase'],
    [{ code: 'Minus', ctrlKey: true }, 'decrease'],
  ] as const)('resolves %o as %s', (event, direction) => {
    expect(resolveEditorFontSizeShortcut(shortcutEvent(event))).toEqual({
      kind: direction,
    });
  });

  it('ignores unbound or alt-modified font size key combinations', () => {
    expect(
      resolveEditorFontSizeShortcut(
        shortcutEvent({ code: 'Minus', metaKey: true, shiftKey: true }),
      ),
    ).toBeNull();
    expect(
      resolveEditorFontSizeShortcut(shortcutEvent({ code: 'Equal', metaKey: true, altKey: true })),
    ).toBeNull();
    expect(resolveEditorFontSizeShortcut(shortcutEvent({ code: 'Equal' }))).toBeNull();
  });
});
