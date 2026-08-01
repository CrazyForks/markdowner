import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import fixture from '../../../tests/fixtures/obsidian-frontmatter.md?raw';
import { FrontMatterExtension } from './frontMatterExtension';

const editors: Editor[] = [];

function buildEditor() {
  const editor = new Editor({
    extensions: [
      FrontMatterExtension,
      StarterKit.configure({ codeBlock: false, trailingNode: false }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: '',
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('FrontMatterExtension', () => {
  it('round-trips the exact empty-body clipping fixture', () => {
    const editor = buildEditor();
    editor.commands.setContent(fixture, { contentType: 'markdown', emitUpdate: false } as never);

    expect(editor.state.doc.firstChild?.type.name).toBe('frontMatter');
    expect(editor.state.doc.firstChild?.attrs.raw).toBe(fixture);
    expect(editor.getMarkdown()).toBe(fixture);
  });

  it('preserves the authored prefix through a body edit and repeated parse', () => {
    const source = `${fixture}# Article notes\n\nThe body remains editable.\n`;
    const editor = buildEditor();
    editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false } as never);
    const paragraphStart = editor.state.doc.content.size - 1;
    editor.commands.insertContentAt(paragraphStart, ' edited');
    const serialized = editor.getMarkdown();

    expect(serialized.startsWith(fixture)).toBe(true);
    editor.commands.setContent(serialized, { contentType: 'markdown', emitUpdate: false } as never);
    expect(editor.getMarkdown()).toBe(serialized);
  });

  it('keeps a body horizontal rule and unclosed delimiter out of the atom', () => {
    const editor = buildEditor();
    editor.commands.setContent('# Body\n\n---\n', { contentType: 'markdown', emitUpdate: false } as never);
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.state.doc.childCount).toBeGreaterThan(1);

    editor.commands.setContent('---\ntitle: Missing close\n', { contentType: 'markdown', emitUpdate: false } as never);
    expect(editor.state.doc.firstChild?.type.name).not.toBe('frontMatter');
  });
});
