import { describe, expect, it } from 'vitest';

import { matchesShortcut, usesCommandModifier } from './keyboardShortcuts';

function shortcutEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: 'x',
    metaKey: false,
    shiftKey: false,
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
