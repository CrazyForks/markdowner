import {
  Decoration,
  EditorView,
  StateField,
  type DecorationSet,
  type EditorState,
} from '@uiw/react-codemirror';

import { findSkillTokenRangesInMarkdown } from './skillTokens';

const skillTokenMark = Decoration.mark({ class: 'cm-skill-token' });

function buildSkillTokenDecorations(
  state: EditorState,
  skillNames: ReadonlySet<string>,
): DecorationSet {
  if (skillNames.size === 0) return Decoration.none;
  const ranges = findSkillTokenRangesInMarkdown(state.doc.toString(), skillNames).map(
    (range) => skillTokenMark.range(range.from, range.to),
  );
  return Decoration.set(ranges, true);
}

/**
 * Renders known Claude Code / Codex skill tokens (`/goal`, `$git-commit`)
 * like inline code in the source editor. A fresh field is created per
 * skill-name set: the extensions array is rebuilt (and CodeMirror
 * reconfigured) whenever the setting or the scanned names change, the same
 * mechanism as the line-wrap toggle.
 */
export function createSourceSkillHighlightExtension(skillNames: ReadonlySet<string>) {
  return StateField.define<DecorationSet>({
    create: (state) => buildSkillTokenDecorations(state, skillNames),
    update(decorations, transaction) {
      if (!transaction.docChanged) return decorations;
      return buildSkillTokenDecorations(transaction.state, skillNames);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
