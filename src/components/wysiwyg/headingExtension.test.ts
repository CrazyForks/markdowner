import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AUTHORING_HEADING_LEVELS,
  COMPATIBILITY_HEADING_LEVELS,
  MarkdownerHeading,
} from './headingExtension';

function buildEditor(content = ''): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: false }),
      MarkdownerHeading,
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content,
    contentType: content ? 'markdown' : undefined,
  });
}

function typeText(editor: Editor, text: string): void {
  for (const character of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handled = view.someProp('handleTextInput', (handler: any) =>
      handler(view, from, to, character),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

describe('MarkdownerHeading', () => {
  let editor: Editor;

  afterEach(() => editor?.destroy());

  it('declares H1-H4 authoring and H1-H6 compatibility levels', () => {
    expect(AUTHORING_HEADING_LEVELS).toEqual([1, 2, 3, 4]);
    expect(COMPATIBILITY_HEADING_LEVELS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each([
    ['# ', 1],
    ['## ', 2],
    ['### ', 3],
    ['#### ', 4],
  ] as const)('converts %s to H%s', (prefix, level) => {
    editor = buildEditor();
    typeText(editor, prefix);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level },
    });
  });

  it.each(['##### ', '###### '] as const)('leaves %s as paragraph text', (prefix) => {
    editor = buildEditor();
    typeText(editor, prefix);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: prefix }],
    });
  });

  it('provides H4 but not H5 keyboard conversion', () => {
    editor = buildEditor();
    editor.commands.keyboardShortcut('Mod-Alt-4');
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 4 },
    });

    editor.destroy();
    editor = buildEditor();
    editor.commands.keyboardShortcut('Mod-Alt-5');
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'paragraph' });
  });

  it('round-trips existing H1-H6 without changing their depths', () => {
    const source = [
      '# One',
      '## Two',
      '### Three',
      '#### Four',
      '##### Five',
      '###### Six',
    ].join('\n\n');
    editor = buildEditor(source);

    expect(editor.getMarkdown().trim()).toBe(source);
  });
});
