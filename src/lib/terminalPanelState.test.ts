import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_HEIGHT_KEY,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
  clampTerminalHeight,
  nextTerminalHeightFromKey,
  readTerminalHeight,
  terminalHeightFromPointerY,
  writeTerminalHeight,
} from './terminalPanelState';

describe('terminal panel height persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(TERMINAL_HEIGHT_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(TERMINAL_HEIGHT_KEY);
  });

  it('clamps terminal height to the supported range', () => {
    expect(clampTerminalHeight(TERMINAL_MIN_HEIGHT - 1)).toBe(TERMINAL_MIN_HEIGHT);
    expect(clampTerminalHeight(TERMINAL_MAX_HEIGHT + 1)).toBe(TERMINAL_MAX_HEIGHT);
    expect(clampTerminalHeight(319.6)).toBe(320);
    expect(clampTerminalHeight(Number.NaN)).toBe(TERMINAL_DEFAULT_HEIGHT);
  });

  it('reads and writes persisted terminal height through the clamp', () => {
    writeTerminalHeight(123);
    expect(window.localStorage.getItem(TERMINAL_HEIGHT_KEY)).toBe(String(TERMINAL_MIN_HEIGHT));

    writeTerminalHeight(360);
    expect(readTerminalHeight()).toBe(360);

    window.localStorage.setItem(TERMINAL_HEIGHT_KEY, 'bad-height');
    expect(readTerminalHeight()).toBe(TERMINAL_DEFAULT_HEIGHT);
  });

  it('calculates terminal height from a top resize handle pointer position', () => {
    expect(terminalHeightFromPointerY(600, 900)).toBe(300);
    expect(terminalHeightFromPointerY(850, 900)).toBe(TERMINAL_MIN_HEIGHT);
    expect(terminalHeightFromPointerY(10, 900)).toBe(TERMINAL_MAX_HEIGHT);
  });

  it('calculates keyboard resize targets and ignores unrelated keys', () => {
    expect(nextTerminalHeightFromKey(280, 'ArrowUp')).toBe(288);
    expect(nextTerminalHeightFromKey(280, 'ArrowDown')).toBe(272);
    expect(nextTerminalHeightFromKey(280, 'PageUp')).toBe(312);
    expect(nextTerminalHeightFromKey(280, 'PageDown')).toBe(248);
    expect(nextTerminalHeightFromKey(280, 'Home')).toBe(TERMINAL_MIN_HEIGHT);
    expect(nextTerminalHeightFromKey(280, 'End')).toBe(TERMINAL_MAX_HEIGHT);
    expect(nextTerminalHeightFromKey(280, 'Escape')).toBeNull();
  });
});
