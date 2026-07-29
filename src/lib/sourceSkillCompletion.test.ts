import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@uiw/react-codemirror';
import { describe, expect, it } from 'vitest';

import {
  createSourceSkillCompletionSource,
  sourceSkillCompletionKeymap,
} from './sourceSkillCompletion';

const NAMES = new Set(['goal', 'git-commit', 'git-commit-push']);

async function completionFor(doc: string, position = doc.length) {
  const { CompletionContext } = await import('@codemirror/autocomplete');
  const state = EditorState.create({
    doc,
    selection: { anchor: position },
    extensions: [markdown()],
  });
  const source = createSourceSkillCompletionSource(NAMES);
  return source(new CompletionContext(state, position, false));
}

describe('Source skill completion', () => {
  it('replaces the full slash query with prefix-preserving skill tokens', async () => {
    const result = await completionFor('Run /git');

    expect(result?.from).toBe(4);
    expect(result?.to).toBe(8);
    expect(result?.options).toMatchObject([
      { label: '/git-commit', apply: '/git-commit' },
      { label: '/git-commit-push', apply: '/git-commit-push' },
    ]);
  });

  it('preserves a dollar prefix', async () => {
    const result = await completionFor('$go');

    expect(result?.from).toBe(0);
    expect(result?.options).toMatchObject([
      { label: '$goal', apply: '$goal' },
    ]);
  });

  it('does not complete inside inline or fenced code', async () => {
    await expect(completionFor('Use `/go`', 8)).resolves.toBeNull();
    await expect(
      completionFor(['```sh', '/go', '```'].join('\n'), 9),
    ).resolves.toBeNull();
  });

  it('does not complete word-internal or URL-like triggers', async () => {
    await expect(completionFor('price$go')).resolves.toBeNull();
    await expect(completionFor('https://go')).resolves.toBeNull();
  });

  it('binds Tab to accept the active completion', () => {
    expect(sourceSkillCompletionKeymap).toHaveLength(1);
    expect(sourceSkillCompletionKeymap[0]?.key).toBe('Tab');
    expect(sourceSkillCompletionKeymap[0]?.run).toEqual(expect.any(Function));
  });
});
