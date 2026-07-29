import { describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import {
  findSkillTokenRanges,
  findSkillTokenRangesInMarkdown,
  loadSkillTokenNames,
} from './skillTokens';

const NAMES = new Set(['goal', 'git-commit', 'superpowers:brainstorming', 'gcpr']);

describe('findSkillTokenRanges', () => {
  it('matches known /name and $name tokens with their sigil', () => {
    const text = 'run /goal then $git-commit please';

    expect(findSkillTokenRanges(text, NAMES)).toEqual([
      { from: 4, to: 9 },
      { from: 15, to: 26 },
    ]);
  });

  it('matches namespaced plugin skills and tokens at text edges', () => {
    expect(findSkillTokenRanges('/superpowers:brainstorming', NAMES)).toEqual([
      { from: 0, to: 26 },
    ]);
    expect(findSkillTokenRanges('use $gcpr', NAMES)).toEqual([{ from: 4, to: 9 }]);
  });

  it('allows trailing punctuation and wrapping brackets', () => {
    expect(findSkillTokenRanges('try /goal, or ($git-commit).', NAMES)).toEqual([
      { from: 4, to: 9 },
      { from: 15, to: 26 },
    ]);
  });

  it('ignores names missing from the skill set', () => {
    expect(findSkillTokenRanges('/unknown $nope', NAMES)).toEqual([]);
  });

  it('ignores tokens glued to preceding words or paths', () => {
    expect(findSkillTokenRanges('path/goal and DELETE /api/goal', NAMES)).toEqual([]);
    expect(findSkillTokenRanges('price$goal', NAMES)).toEqual([]);
  });

  it('ignores tokens continuing into non-boundary characters', () => {
    expect(findSkillTokenRanges('/goal/sub and /goal#anchor', NAMES)).toEqual([]);
  });

  it('is case-sensitive like the real skill registries', () => {
    expect(findSkillTokenRanges('/Goal', NAMES)).toEqual([]);
  });
});

describe('findSkillTokenRangesInMarkdown', () => {
  it('offsets ranges across lines', () => {
    const text = 'first line\nuse /goal here';

    expect(findSkillTokenRangesInMarkdown(text, NAMES)).toEqual([
      { from: 15, to: 20 },
    ]);
  });

  it('skips tokens inside fenced code blocks', () => {
    const text = '```sh\n/goal\n```\n/goal';

    expect(findSkillTokenRangesInMarkdown(text, NAMES)).toEqual([
      { from: 16, to: 21 },
    ]);
  });

  it('skips tokens inside inline backtick spans', () => {
    const text = 'run `/goal` or ` $gcpr ` but /goal works';

    expect(findSkillTokenRangesInMarkdown(text, NAMES)).toEqual([
      { from: 29, to: 34 },
    ]);
  });
});

describe('loadSkillTokenNames', () => {
  it('returns string entries from the backend', async () => {
    invokeMock.mockResolvedValueOnce(['goal', 42, '', 'git-commit']);

    await expect(loadSkillTokenNames()).resolves.toEqual(['goal', 'git-commit']);
    expect(invokeMock).toHaveBeenCalledWith('list_skill_names');
  });

  it('returns an empty list when the backend is unavailable', async () => {
    invokeMock.mockRejectedValueOnce(new Error('no backend'));
    await expect(loadSkillTokenNames()).resolves.toEqual([]);

    invokeMock.mockResolvedValueOnce(undefined);
    await expect(loadSkillTokenNames()).resolves.toEqual([]);
  });
});
