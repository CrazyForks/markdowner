/**
 * Real-library tests for the CodeMirror skill-token decorations (the mocked
 * sourceEditorExtensions.test.ts only checks extension ordering).
 */
import { EditorState } from '@uiw/react-codemirror';
import { describe, expect, it } from 'vitest';

import { createSourceSkillHighlightExtension } from './sourceSkillHighlight';

const NAMES = new Set(['goal', 'git-commit']);

function decorationRanges(
  state: EditorState,
  field: ReturnType<typeof createSourceSkillHighlightExtension>,
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

describe('source skill token highlight field', () => {
  it('marks known skill tokens on creation', () => {
    const field = createSourceSkillHighlightExtension(NAMES);
    const state = EditorState.create({
      doc: 'run /goal then $git-commit',
      extensions: [field],
    });

    expect(decorationRanges(state, field)).toEqual([
      { from: 4, to: 9, cls: 'cm-skill-token' },
      { from: 15, to: 26, cls: 'cm-skill-token' },
    ]);
  });

  it('rescans as the document changes', () => {
    const field = createSourceSkillHighlightExtension(NAMES);
    let state = EditorState.create({ doc: 'type /goa', extensions: [field] });
    expect(decorationRanges(state, field)).toEqual([]);

    state = state.update({ changes: { from: 9, insert: 'l' } }).state;

    expect(decorationRanges(state, field)).toEqual([
      { from: 5, to: 10, cls: 'cm-skill-token' },
    ]);
  });

  it('leaves fenced and inline code regions unmarked', () => {
    const field = createSourceSkillHighlightExtension(NAMES);
    const state = EditorState.create({
      doc: '```\n/goal\n```\nuse `/goal` or /goal',
      extensions: [field],
    });

    expect(decorationRanges(state, field)).toEqual([
      { from: 29, to: 34, cls: 'cm-skill-token' },
    ]);
  });

  it('stays empty with no known skill names', () => {
    const field = createSourceSkillHighlightExtension(new Set());
    const state = EditorState.create({ doc: 'run /goal', extensions: [field] });

    expect(decorationRanges(state, field)).toEqual([]);
  });
});
