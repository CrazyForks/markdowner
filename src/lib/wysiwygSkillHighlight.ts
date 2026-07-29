import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { findSkillTokenRanges } from './skillTokens';

export type WysiwygSkillHighlightConfig = {
  enabled: boolean;
  skillNames: ReadonlySet<string>;
};

type SkillHighlightState = {
  config: WysiwygSkillHighlightConfig;
  decorations: DecorationSet;
};

const skillHighlightPluginKey = new PluginKey<SkillHighlightState>('wysiwygSkillHighlight');

const INACTIVE_CONFIG: WysiwygSkillHighlightConfig = {
  enabled: false,
  skillNames: new Set(),
};

function buildSkillTokenDecorations(
  doc: ProseMirrorNode,
  config: WysiwygSkillHighlightConfig,
): DecorationSet {
  if (!config.enabled || config.skillNames.size === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    // Code blocks already read as code — skip the whole subtree.
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return true;
    // Same reasoning for text carrying the inline `code` mark.
    if (node.marks.some((mark) => mark.type.name === 'code')) return true;
    for (const range of findSkillTokenRanges(node.text, config.skillNames)) {
      decorations.push(
        Decoration.inline(pos + range.from, pos + range.to, {
          class: 'wysiwyg-skill-token',
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Renders known Claude Code / Codex skill tokens (`/goal`, `$git-commit`)
 * like inline code in the WYSIWYG surface. Registered once with the editor;
 * the setting and the scanned skill names arrive later via transaction meta
 * (`setWysiwygSkillHighlight`) because recreating Tiptap extensions tears
 * down in-flight IME compositions in WebKit (see App's wysiwygExtensions).
 * Unlike the find highlight, ordinary typing transactions rescan instead of
 * mapping — tokens appear and disappear as they are typed.
 */
export const WysiwygSkillHighlight = Extension.create({
  name: 'wysiwygSkillHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<SkillHighlightState>({
        key: skillHighlightPluginKey,
        state: {
          init: () => ({ config: INACTIVE_CONFIG, decorations: DecorationSet.empty }),
          apply(transaction, current) {
            const config = transaction.getMeta(skillHighlightPluginKey) as
              | WysiwygSkillHighlightConfig
              | undefined;
            if (config !== undefined) {
              return {
                config,
                decorations: buildSkillTokenDecorations(transaction.doc, config),
              };
            }
            if (transaction.docChanged) {
              return {
                config: current.config,
                decorations: buildSkillTokenDecorations(transaction.doc, current.config),
              };
            }
            return current;
          },
        },
        props: {
          decorations(state) {
            return skillHighlightPluginKey.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});

/** Push the highlight config (setting + scanned skill names) into the view. */
export function setWysiwygSkillHighlight(
  editor: Pick<Editor, 'view'> | null | undefined,
  config: WysiwygSkillHighlightConfig,
) {
  const view = editor?.view;
  // Partially-initialized editors and test mocks expose a reduced view —
  // bail instead of crashing.
  if (!view?.dispatch || typeof view.state?.tr?.setMeta !== 'function') return;
  view.dispatch(
    view.state.tr.setMeta(skillHighlightPluginKey, config).setMeta('addToHistory', false),
  );
}
