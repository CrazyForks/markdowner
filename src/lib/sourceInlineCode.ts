import { syntaxTree } from '@codemirror/language';
import {
  Decoration,
  EditorView,
  StateField,
  type DecorationSet,
  type EditorState,
} from '@uiw/react-codemirror';

const inlineCodeMark = Decoration.mark({ class: 'cm-inline-code' });

function buildInlineCodeDecorations(state: EditorState): DecorationSet {
  const ranges: ReturnType<typeof inlineCodeMark.range>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'InlineCode') {
        ranges.push(inlineCodeMark.range(node.from, node.to));
      }
    },
  });
  return Decoration.set(ranges, true);
}

/**
 * Marks Markdown inline-code syntax in Source mode without touching fenced
 * code nodes. Rescanning after document edits keeps syntax-tree boundaries
 * authoritative for single- and multi-backtick spans.
 */
export function createSourceInlineCodeExtension() {
  return StateField.define<DecorationSet>({
    create: buildInlineCodeDecorations,
    update(decorations, transaction) {
      return transaction.docChanged
        ? buildInlineCodeDecorations(transaction.state)
        : decorations.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
