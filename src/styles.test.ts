import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('src/styles.css', 'utf8');

function ruleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));

  return match?.[1] ?? '';
}

describe('editor word wrap stylesheet', () => {
  it('disables automatic ProseMirror wrapping when WYSIWYG word wrap is off', () => {
    const proseMirrorRule = ruleBody(
      ".editor-pane-wysiwyg[data-line-wrap='false'] .notion-editor-content .ProseMirror",
    );

    expect(proseMirrorRule).toContain('white-space: pre;');
    expect(proseMirrorRule).toContain('overflow-wrap: normal;');
    expect(proseMirrorRule).toContain('word-wrap: normal;');
  });
});
