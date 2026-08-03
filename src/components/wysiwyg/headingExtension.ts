import { textblockTypeInputRule } from '@tiptap/core';
import Heading, { type Level } from '@tiptap/extension-heading';

export const COMPATIBILITY_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const satisfies readonly Level[];
export const AUTHORING_HEADING_LEVELS = [1, 2, 3, 4] as const satisfies readonly Level[];

export type AuthoringHeadingLevel = (typeof AUTHORING_HEADING_LEVELS)[number];

export const MarkdownerHeading = Heading.extend({
  addKeyboardShortcuts() {
    return AUTHORING_HEADING_LEVELS.reduce<Record<string, () => boolean>>(
      (shortcuts, level) => {
        shortcuts[`Mod-Alt-${level}`] = () => this.editor.commands.toggleHeading({ level });
        return shortcuts;
      },
      {},
    );
  },

  addInputRules() {
    return AUTHORING_HEADING_LEVELS.map((level) =>
      textblockTypeInputRule({
        find: new RegExp(`^(#{${level}})\\s$`),
        type: this.type,
        getAttributes: { level },
      }),
    );
  },
}).configure({ levels: [...COMPATIBILITY_HEADING_LEVELS] });
