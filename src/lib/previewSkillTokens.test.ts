import { describe, expect, it } from 'vitest';

import { createPreviewSkillTokenPlugin } from './previewSkillTokens';

describe('Preview skill-token transformer', () => {
  it('wraps known plain-text tokens and skips code descendants', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: 'Run /goal and ' },
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              children: [{ type: 'text', value: '$git-commit' }],
            },
            { type: 'text', value: ' then $git-commit.' },
          ],
        },
      ],
    };

    const transform = createPreviewSkillTokenPlugin(
      new Set(['goal', 'git-commit']),
      true,
    )();
    transform(tree);

    const paragraph = tree.children[0];
    expect(paragraph.children).toMatchObject([
      { type: 'text', value: 'Run ' },
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['preview-skill-token'] },
        children: [{ type: 'text', value: '/goal' }],
      },
      { type: 'text', value: ' and ' },
      {
        type: 'element',
        tagName: 'code',
        children: [{ type: 'text', value: '$git-commit' }],
      },
      { type: 'text', value: ' then ' },
      {
        type: 'element',
        tagName: 'span',
        children: [{ type: 'text', value: '$git-commit' }],
      },
      { type: 'text', value: '.' },
    ]);
  });

  it('leaves the tree unchanged when highlighting is disabled', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'text', value: '/goal' }],
    };
    const original = structuredClone(tree);

    createPreviewSkillTokenPlugin(new Set(['goal']), false)()(tree);

    expect(tree).toEqual(original);
  });
});
