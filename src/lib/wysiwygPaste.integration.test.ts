/**
 * Integration test that drives the real @tiptap/core + @tiptap/markdown stack
 * through the actual ProseMirror paste pipeline. It is the regression net for
 * "pasted markdown shows as raw text in WYSIWYG mode": the mocked unit tests in
 * wysiwygPaste.test.ts can't catch a wrong call into the real `marked` parser,
 * so this exercises end-to-end rendering and the false-positive guards.
 */
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
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

import {
  handleWysiwygPlainTextPaste,
  isPlainTextPasteRequest,
} from './wysiwygPaste';

const lowlight = createLowlight(common);

let editor: Editor;

// Mirror App.tsx's handlePaste wiring so the test covers the real call chain,
// including the Cmd/Ctrl+Shift+V plain-text branch.
function buildEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: '',
    editorProps: {
      handlePaste: (view, event) =>
        handleWysiwygPlainTextPaste(
          view as never,
          event as never,
          editor as never,
          isPlainTextPasteRequest(view as never),
        ),
    },
  });
}

function paste(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    configurable: true,
  });
  editor.view.dom.dispatchEvent(event);
}

// Collect the top-level block node types of the current document.
function blockTypes(): string[] {
  return (editor.getJSON().content ?? []).map((n: { type: string }) => n.type);
}

describe('WYSIWYG markdown paste (real editor)', () => {
  afterEach(() => editor?.destroy());

  it('renders inline-only markdown instead of pasting it verbatim', () => {
    editor = buildEditor();
    editor.commands.focus();
    paste('This is **bold**, *italic*, `code`, and [a link](https://x.com).');

    const json = editor.getJSON();
    const para = json.content?.[0];
    expect(para?.type).toBe('paragraph');
    const marks = (para?.content ?? []).flatMap(
      (n: { marks?: { type: string }[] }) => (n.marks ?? []).map((m) => m.type),
    );
    expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'code', 'link']));
    // The raw markers must be gone from the rendered text.
    expect(editor.getText()).not.toContain('**');
    expect(editor.getText()).not.toContain('`');
  });

  it('renders a setext heading', () => {
    editor = buildEditor();
    editor.commands.focus();
    paste('Title\n=====\n\nBody paragraph.');
    expect(blockTypes()).toContain('heading');
  });

  it('renders ATX headings and lists', () => {
    editor = buildEditor();
    editor.commands.focus();
    paste('# Heading\n\n- one\n- two');
    expect(blockTypes()).toEqual(expect.arrayContaining(['heading', 'bulletList']));
  });

  it('renders a GFM table', () => {
    editor = buildEditor();
    editor.commands.focus();
    paste('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(blockTypes()).toContain('table');
  });

  it('keeps ambiguous "5 * 3 = 15" as literal text (no italic)', () => {
    editor = buildEditor();
    editor.commands.focus();
    paste('5 * 3 = 15');
    expect(editor.getText()).toBe('5 * 3 = 15');
    const para = editor.getJSON().content?.[0];
    const marks = (para?.content ?? []).flatMap(
      (n: { marks?: { type: string }[] }) => (n.marks ?? []).map((m) => m.type),
    );
    expect(marks).toEqual([]);
  });

  it('keeps snake_case identifiers and file paths literal', () => {
    editor = buildEditor();
    editor.commands.focus();
    paste('snake_case_name and path/to/file.ts');
    expect(editor.getText()).toBe('snake_case_name and path/to/file.ts');
  });

  it('pastes plain prose verbatim', () => {
    editor = buildEditor();
    editor.commands.focus();
    paste('Just some prose with no special shape.');
    expect(blockTypes()).toEqual(['paragraph']);
    expect(editor.getText()).toBe('Just some prose with no special shape.');
  });

  it('Cmd/Ctrl+Shift+V bypasses markdown rendering (literal characters)', () => {
    editor = buildEditor();
    editor.commands.focus();
    // Simulate Shift held at paste time, the signal isPlainTextPasteRequest reads.
    (editor.view as unknown as { input: { shiftKey: boolean; lastKeyCode: number } }).input.shiftKey = true;
    (editor.view as unknown as { input: { shiftKey: boolean; lastKeyCode: number } }).input.lastKeyCode = 86;
    paste('# Heading with **bold**');
    expect(blockTypes()).toEqual(['paragraph']);
    expect(editor.getText()).toContain('# Heading with **bold**');
  });
});
