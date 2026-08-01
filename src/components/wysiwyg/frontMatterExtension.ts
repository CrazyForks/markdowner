import { Node, type MarkdownToken } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { frontMatterStatus, parseLeadingFrontMatter } from '@/lib/frontMatter';
import { FrontMatterView } from './FrontMatterView';

type FrontMatterToken = MarkdownToken & {
  attributes?: {
    raw: string;
    valid: boolean;
    issues: Array<{ message: string; line: number; column: number }>;
  };
};

export const FrontMatterExtension = Node.create({
  name: 'frontMatter',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,
  defining: true,
  // Keep paragraph ahead of this atom in the schema so ProseMirror's required
  // `block+` filler for an empty document remains an empty paragraph.
  priority: 90,

  addAttributes() {
    return {
      raw: { default: '' },
      valid: { default: false },
      issues: { default: [] },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-front-matter]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-front-matter': '' }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FrontMatterView);
  },

  markdownTokenName: 'frontMatter',

  markdownTokenizer: {
    name: 'frontMatter',
    level: 'block',
    start(src) {
      return parseLeadingFrontMatter(src).hasFrontMatter ? 0 : -1;
    },
    tokenize(src, tokens) {
      if (tokens.length > 0) return undefined;
      const parsed = parseLeadingFrontMatter(src);
      if (!parsed.hasFrontMatter) return undefined;
      return {
        type: 'frontMatter',
        raw: parsed.raw,
        attributes: {
          raw: parsed.raw,
          valid: parsed.valid,
          issues: [...parsed.issues],
        },
      };
    },
  },

  parseMarkdown(token, helpers) {
    const frontMatter = token as FrontMatterToken;
    const raw = frontMatter.attributes?.raw ?? token.raw ?? '';
    const status = frontMatter.attributes ?? { raw, ...frontMatterStatus(raw) };
    return helpers.createNode('frontMatter', status, []);
  },

  renderMarkdown(node) {
    return typeof node.attrs?.raw === 'string' ? node.attrs.raw : '';
  },
});
