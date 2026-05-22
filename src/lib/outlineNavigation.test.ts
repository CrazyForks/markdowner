import { describe, expect, it } from 'vitest';

import { parseMarkdownOutline } from './outline';
import {
  resolveOutlineMatchByOccurrence,
  resolveOutlineNavigationTarget,
} from './outlineNavigation';

describe('resolveOutlineNavigationTarget', () => {
  it('resolves duplicate heading titles to the matching literal occurrence', () => {
    const source = '# Intro\n\n## Intro\n\nBody';
    const secondIntro = parseMarkdownOutline(source)[1];

    expect(resolveOutlineNavigationTarget(source, secondIntro)).toEqual({
      sourceOffset: secondIntro.titleStart,
      titleText: 'Intro',
      titleOccurrenceIndex: 1,
    });
  });

  it('falls back to the parsed title when the source slice is empty', () => {
    const target = resolveOutlineNavigationTarget('', {
      id: 'stale',
      depth: 1,
      title: 'Fallback',
      titleStart: 99,
      titleEnd: 99,
      selectionStart: 0,
      selectionEnd: 0,
    });

    expect(target).toEqual({
      sourceOffset: 99,
      titleText: 'Fallback',
      titleOccurrenceIndex: 0,
    });
  });
});

describe('resolveOutlineMatchByOccurrence', () => {
  it('selects the matching duplicate occurrence and falls back to the first match', () => {
    const matches = ['first', 'second'];

    expect(resolveOutlineMatchByOccurrence(matches, 1)).toBe('second');
    expect(resolveOutlineMatchByOccurrence(matches, 99)).toBe('first');
    expect(resolveOutlineMatchByOccurrence([], 0)).toBeUndefined();
  });
});
