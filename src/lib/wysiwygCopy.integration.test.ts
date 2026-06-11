/**
 * Integration test that drives the real @tiptap/core + @tiptap/markdown stack
 * and confirms a copied WYSIWYG selection serializes to markdown the way the
 * clipboard handler will see it: `selection.content()` is exactly the Slice
 * prosemirror-view hands to `clipboardTextSerializer`.
 */
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { afterEach, describe, expect, it } from 'vitest';

import { serializeWysiwygSliceToMarkdown } from './wysiwygCopy';

const lowlight = createLowlight(common);

function buildEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: '',
  });
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function loadMarkdown(markdown: string) {
  editor = buildEditor();
  editor.commands.setContent(markdown, {
    contentType: 'markdown',
    emitUpdate: false,
  } as never);
  return editor;
}

describe('serializeWysiwygSliceToMarkdown (real editor)', () => {
  it('keeps the blank line between blocks on a select-all copy', () => {
    const ed = loadMarkdown('# Test Title\n\nThis is **bold** and plain text.');
    ed.commands.selectAll();

    const markdown = serializeWysiwygSliceToMarkdown(ed.state.selection.content(), ed);

    expect(markdown).toBe('# Test Title\n\nThis is **bold** and plain text.');
  });

  it('serializes a partial inline selection with its marks', () => {
    const ed = loadMarkdown('This is **bold** and plain text.');

    // Find the bold text node so the selection spans "is **bold**".
    let boldFrom = -1;
    let boldTo = -1;
    ed.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'bold') {
        boldFrom = pos;
        boldTo = pos + node.nodeSize;
      }
    });
    expect(boldFrom).toBeGreaterThan(-1);
    ed.commands.setTextSelection({ from: boldFrom - 3, to: boldTo });

    const markdown = serializeWysiwygSliceToMarkdown(ed.state.selection.content(), ed);

    expect(markdown).toBe('is **bold**');
  });

  it('serializes list selections back to list markdown', () => {
    const ed = loadMarkdown('- first\n- second\n- third');
    ed.commands.selectAll();

    const markdown = serializeWysiwygSliceToMarkdown(ed.state.selection.content(), ed);

    expect(markdown).toBe('- first\n- second\n- third');
  });
});
