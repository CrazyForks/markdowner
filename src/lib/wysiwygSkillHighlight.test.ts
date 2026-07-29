/**
 * The WYSIWYG skill-token decorations render as inline spans in the editor
 * DOM — assert through the DOM since that is exactly what the user sees.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WysiwygSkillHighlight,
  setWysiwygSkillHighlight,
} from './wysiwygSkillHighlight';

const CONFIG = {
  enabled: true,
  skillNames: new Set(['goal', 'git-commit']),
};

describe('WysiwygSkillHighlight', () => {
  let editor: Editor;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [StarterKit, WysiwygSkillHighlight],
      content: '<p>run /goal then $git-commit</p>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('paints known skill tokens once configured', () => {
    expect(host.querySelectorAll('.wysiwyg-skill-token')).toHaveLength(0);

    setWysiwygSkillHighlight(editor, CONFIG);

    const tokens = host.querySelectorAll('.wysiwyg-skill-token');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].textContent).toBe('/goal');
    expect(tokens[1].textContent).toBe('$git-commit');
  });

  it('clears the highlights when disabled', () => {
    setWysiwygSkillHighlight(editor, CONFIG);
    setWysiwygSkillHighlight(editor, { ...CONFIG, enabled: false });

    expect(host.querySelectorAll('.wysiwyg-skill-token')).toHaveLength(0);
  });

  it('rescans as the document changes', () => {
    setWysiwygSkillHighlight(editor, CONFIG);
    editor.commands.setContent('<p>type /goa</p>');
    expect(host.querySelectorAll('.wysiwyg-skill-token')).toHaveLength(0);

    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'l');

    const tokens = host.querySelectorAll('.wysiwyg-skill-token');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].textContent).toBe('/goal');
  });

  it('skips code blocks and inline code marks', () => {
    setWysiwygSkillHighlight(editor, CONFIG);
    editor.commands.setContent('<pre><code>/goal</code></pre><p><code>/goal</code> and /goal</p>');

    const tokens = host.querySelectorAll('.wysiwyg-skill-token');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].textContent).toBe('/goal');
  });
});
