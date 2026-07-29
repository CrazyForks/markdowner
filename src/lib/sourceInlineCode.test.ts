import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@uiw/react-codemirror';
import { describe, expect, it } from 'vitest';

import { createSourceInlineCodeExtension } from './sourceInlineCode';

function decorationRanges(
  state: EditorState,
  field: ReturnType<typeof createSourceInlineCodeExtension>,
): Array<{ from: number; to: number; cls: string }> {
  const found: Array<{ from: number; to: number; cls: string }> = [];
  const iter = state.field(field).iter();
  while (iter.value) {
    found.push({
      from: iter.from,
      to: iter.to,
      cls: (iter.value.spec as { class?: string }).class ?? '',
    });
    iter.next();
  }
  return found;
}

describe('source inline-code decoration field', () => {
  it('marks complete Markdown inline-code spans', () => {
    const field = createSourceInlineCodeExtension();
    const state = EditorState.create({
      doc: 'use `pnpm test` now',
      extensions: [markdown(), field],
    });

    expect(decorationRanges(state, field)).toEqual([
      { from: 4, to: 15, cls: 'cm-inline-code' },
    ]);
  });

  it('marks multi-backtick spans without touching fenced code', () => {
    const field = createSourceInlineCodeExtension();
    const state = EditorState.create({
      doc: ['Use ``a `tick` here``.', '', '```sh', '`not inline`', '```'].join('\n'),
      extensions: [markdown(), field],
    });

    expect(decorationRanges(state, field)).toEqual([
      { from: 4, to: 21, cls: 'cm-inline-code' },
    ]);
  });

  it('rescans inline-code spans after document edits', () => {
    const field = createSourceInlineCodeExtension();
    let state = EditorState.create({
      doc: 'use pnpm',
      extensions: [markdown(), field],
    });
    expect(decorationRanges(state, field)).toEqual([]);

    state = state.update({
      changes: [
        { from: 4, insert: '`' },
        { from: 8, insert: '`' },
      ],
    }).state;

    expect(decorationRanges(state, field)).toEqual([
      { from: 4, to: 10, cls: 'cm-inline-code' },
    ]);
  });
});
