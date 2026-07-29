import {
  acceptCompletion,
  autocompletion,
  type CompletionContext,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { keymap, type KeyBinding } from '@uiw/react-codemirror';

import {
  buildSkillSuggestions,
  findSkillSuggestionQuery,
} from './skillSuggestions';

const CODE_NODE_NAMES = new Set([
  'InlineCode',
  'FencedCode',
  'CodeText',
  'CodeBlock',
]);

export const sourceSkillCompletionKeymap: readonly KeyBinding[] = [
  {
    key: 'Tab',
    run: acceptCompletion,
  },
];

function isInsideCode(context: CompletionContext): boolean {
  let node = syntaxTree(context.state).resolveInner(context.pos, -1);
  while (true) {
    if (CODE_NODE_NAMES.has(node.name)) return true;
    const parent = node.parent;
    if (!parent) return false;
    node = parent;
  }
}

export function createSourceSkillCompletionSource(
  skillNames: Iterable<string>,
): CompletionSource {
  const installedSkillNames = [...skillNames];

  return (context) => {
    if (isInsideCode(context)) return null;

    const line = context.state.doc.lineAt(context.pos);
    const textBeforeCaret = context.state.doc.sliceString(line.from, context.pos);
    const query = findSkillSuggestionQuery(textBeforeCaret);
    if (!query) return null;

    const suggestions = buildSkillSuggestions(
      query.prefix,
      query.query,
      installedSkillNames,
    );
    if (suggestions.length === 0) return null;

    return {
      from: line.from + query.from,
      to: context.pos,
      options: suggestions.map(({ token }) => ({
        label: token,
        apply: token,
        type: 'keyword',
        detail: 'Installed skill',
      })),
      validFor: /^[/$][A-Za-z0-9_-]*(?::[A-Za-z0-9_-]*)?$/,
    };
  };
}

export function createSourceSkillCompletionExtension(
  skillNames: Iterable<string>,
) {
  return [
    autocompletion({
      override: [createSourceSkillCompletionSource(skillNames)],
      activateOnTyping: true,
    }),
    keymap.of(sourceSkillCompletionKeymap),
  ];
}
