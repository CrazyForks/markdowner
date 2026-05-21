import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';

import { CodeBlockView } from './CodeBlockView';

// Shared lowlight registry. `common` covers the languages exposed through
// `CODE_BLOCK_LANGUAGES` plus a few near-aliases (e.g. shell vs bash) that
// users may type into the dropdown.
const lowlight = createLowlight(common);

// Move keyboard focus to the language picker rendered by the NodeView at the
// given document position. Returns true when the focus actually moved so the
// caller can `preventDefault` the originating arrow keypress. The picker is
// rendered as an HTMLButtonElement (custom listbox), not a native <select>.
function focusLanguageSelectorAtPos(editor: Editor, pos: number): boolean {
  const dom = editor.view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return false;
  const trigger = dom.querySelector('[data-code-block-language-select]');
  if (trigger instanceof HTMLButtonElement && !trigger.disabled) {
    trigger.focus();
    return true;
  }
  return false;
}

export function createCodeBlockExtension() {
  return CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
    addKeyboardShortcuts() {
      return {
        // ArrowDown into a code block: stop at the language picker first so
        // the user can change the language (or just press ArrowDown again to
        // continue into the code body).
        ArrowDown: ({ editor }) => {
          const { state } = editor;
          const { selection } = state;
          if (!selection.empty) return false;
          const { $from } = selection;
          if ($from.parent.type.name === 'codeBlock') return false;
          // Only intercept when the caret sits at the very end of its block,
          // i.e. the next ArrowDown would otherwise step into a sibling node.
          if ($from.parentOffset < $from.parent.content.size) return false;
          if ($from.depth === 0) return false;
          const afterPos = $from.after();
          const nodeAfter = state.doc.nodeAt(afterPos);
          if (nodeAfter?.type.name !== 'codeBlock') return false;
          return focusLanguageSelectorAtPos(editor, afterPos);
        },
        // ArrowUp from the first line of a code block: stop at the language
        // picker so the user can change the language before leaving the block.
        ArrowUp: ({ editor }) => {
          const { state } = editor;
          const { selection } = state;
          if (!selection.empty) return false;
          const { $from } = selection;
          if ($from.parent.type.name !== 'codeBlock') return false;
          const beforeText = $from.parent.textBetween(0, $from.parentOffset);
          if (beforeText.includes('\n')) return false;
          const codeBlockPos = $from.before($from.depth);
          return focusLanguageSelectorAtPos(editor, codeBlockPos);
        },
      };
    },
  }).configure({
    lowlight,
    defaultLanguage: null,
    HTMLAttributes: {
      class: 'code-block',
    },
  });
}
