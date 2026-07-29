import { describe, expect, it } from 'vitest';

import {
  buildSkillSuggestions,
  findSkillSuggestionQuery,
} from './skillSuggestions';

const NAMES = new Set([
  'goal',
  'git-commit',
  'git-commit-push',
  'superpowers:brainstorming',
]);

describe('skill suggestion queries', () => {
  it('finds slash and dollar queries at text boundaries', () => {
    expect(findSkillSuggestionQuery('/gi')).toEqual({
      prefix: '/',
      query: 'gi',
      from: 0,
      to: 3,
    });
    expect(findSkillSuggestionQuery('Run $go')).toEqual({
      prefix: '$',
      query: 'go',
      from: 4,
      to: 7,
    });
    expect(findSkillSuggestionQuery('Use /superpowers:br')).toEqual({
      prefix: '/',
      query: 'superpowers:br',
      from: 4,
      to: 19,
    });
  });

  it('supports an empty query immediately after a trigger', () => {
    expect(findSkillSuggestionQuery('Run /')).toEqual({
      prefix: '/',
      query: '',
      from: 4,
      to: 5,
    });
    expect(findSkillSuggestionQuery('$')).toEqual({
      prefix: '$',
      query: '',
      from: 0,
      to: 1,
    });
  });

  it('rejects triggers inside words, URLs, and multi-segment paths', () => {
    expect(findSkillSuggestionQuery('price$go')).toBeNull();
    expect(findSkillSuggestionQuery('https://gi')).toBeNull();
    expect(findSkillSuggestionQuery('DELETE /api/users')).toBeNull();
  });

  it('builds sorted fuzzy matches while preserving the prefix', () => {
    expect(buildSkillSuggestions('/', 'git', NAMES)).toEqual([
      { name: 'git-commit', token: '/git-commit' },
      { name: 'git-commit-push', token: '/git-commit-push' },
    ]);
    expect(buildSkillSuggestions('$', 'goal', NAMES)).toEqual([
      { name: 'goal', token: '$goal' },
    ]);
  });

  it('deduplicates installed names and returns all names for an empty query', () => {
    expect(
      buildSkillSuggestions('/', '', [
        'goal',
        'git-commit',
        'goal',
      ]),
    ).toEqual([
      { name: 'git-commit', token: '/git-commit' },
      { name: 'goal', token: '/goal' },
    ]);
  });
});
