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
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { common, createLowlight } from 'lowlight';
import { afterEach, describe, expect, it } from 'vitest';

import { FrontMatterExtension } from '@/components/wysiwyg/frontMatterExtension';
import { serializeWysiwygSliceToMarkdown } from './wysiwygCopy';
import {
  handleWysiwygPlainTextPaste,
  isPlainTextPasteRequest,
} from './wysiwygPaste';
import obsidianFixture from '../../tests/fixtures/obsidian-frontmatter.md?raw';

const lowlight = createLowlight(common);

type ClipboardPayload = {
  plain: string;
  html: string;
};

const editors: Editor[] = [];

// Mirror App.tsx's paste and copy wiring so each source/target pair exercises
// ProseMirror's real clipboard serialization and parsing pipeline.
function buildEditor(markdown = '') {
  const editorRef: { current: Editor | null } = { current: null };
  const instance = new Editor({
    extensions: [
      FrontMatterExtension,
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
          editorRef.current as never,
          isPlainTextPasteRequest(view as never),
        ),
      clipboardTextSerializer: (slice) =>
        serializeWysiwygSliceToMarkdown(slice, editorRef.current),
    },
  });
  editorRef.current = instance;
  if (markdown) {
    instance.commands.setContent(markdown, {
      contentType: 'markdown',
      emitUpdate: false,
    } as never);
  }
  editors.push(instance);
  return instance;
}

function paste(
  target: Editor,
  payload: ClipboardPayload,
  { forcePlainText = false } = {},
) {
  const input = (
    target.view as unknown as {
      input: { shiftKey: boolean; lastKeyCode: number };
    }
  ).input;
  input.shiftKey = forcePlainText;
  input.lastKeyCode = forcePlainText ? 86 : 0;

  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) =>
        type === 'text/plain'
          ? payload.plain
          : type === 'text/html'
            ? payload.html
            : '',
    },
    configurable: true,
  });
  target.view.dom.dispatchEvent(event);
}

function copySelection(source: Editor): ClipboardPayload {
  const { dom, text } = source.view.serializeForClipboard(
    source.state.selection.content(),
  );
  return { plain: text, html: dom.innerHTML };
}

function findNodePos(source: Editor, type: string): number {
  let found = -1;
  source.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`Missing ${type} node`);
  return found;
}

function selectCodeText(
  source: Editor,
  fromOffset = 0,
  toOffset?: number,
) {
  const codePos = findNodePos(source, 'codeBlock');
  const code = source.state.doc.nodeAt(codePos);
  if (!code) throw new Error('Missing code block');
  source.view.dispatch(
    source.state.tr.setSelection(
      TextSelection.create(
        source.state.doc,
        codePos + 1 + fromOffset,
        codePos + 1 + (toOffset ?? code.content.size),
      ),
    ),
  );
}

function setCursorAfter(target: Editor, text: string) {
  let position = -1;
  target.state.doc.descendants((node, pos) => {
    if (position < 0 && node.isText) {
      const index = node.text?.indexOf(text) ?? -1;
      if (index >= 0) {
        position = pos + index + text.length;
        return false;
      }
    }
    return true;
  });
  if (position < 0) throw new Error(`Missing cursor anchor: ${text}`);
  target.commands.setTextSelection(position);
}

function blockTypes(target: Editor): string[] {
  return (target.getJSON().content ?? []).map(
    (node: { type: string }) => node.type,
  );
}

function firstTextContent(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const content = (node as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0];
  if (!first || typeof first !== 'object') return undefined;
  const text = (first as { text?: unknown }).text;
  return typeof text === 'string' ? text : undefined;
}

describe('WYSIWYG markdown paste (real editor)', () => {
  afterEach(() => {
    while (editors.length > 0) editors.pop()?.destroy();
  });

  it('renders inline-only markdown instead of pasting it verbatim', () => {
    const target = buildEditor();
    target.commands.focus();
    paste(target, {
      plain: 'This is **bold**, *italic*, `code`, and [a link](https://x.com).',
      html: '',
    });

    const json = target.getJSON();
    const para = json.content?.[0];
    expect(para?.type).toBe('paragraph');
    const marks = (para?.content ?? []).flatMap(
      (n: { marks?: { type: string }[] }) => (n.marks ?? []).map((m) => m.type),
    );
    expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'code', 'link']));
    // The raw markers must be gone from the rendered text.
    expect(target.getText()).not.toContain('**');
    expect(target.getText()).not.toContain('`');
  });

  it('renders a setext heading', () => {
    const target = buildEditor();
    target.commands.focus();
    paste(target, { plain: 'Title\n=====\n\nBody paragraph.', html: '' });
    expect(blockTypes(target)).toContain('heading');
  });

  it('renders ATX headings and lists', () => {
    const target = buildEditor();
    target.commands.focus();
    paste(target, { plain: '# Heading\n\n- one\n- two', html: '' });
    expect(blockTypes(target)).toEqual(
      expect.arrayContaining(['heading', 'bulletList']),
    );
  });

  it('renders a GFM table', () => {
    const target = buildEditor();
    target.commands.focus();
    paste(target, {
      plain: '| a | b |\n| --- | --- |\n| 1 | 2 |',
      html: '',
    });
    expect(blockTypes(target)).toContain('table');
  });

  it('keeps ambiguous "5 * 3 = 15" as literal text (no italic)', () => {
    const target = buildEditor();
    target.commands.focus();
    paste(target, { plain: '5 * 3 = 15', html: '' });
    expect(target.getText()).toBe('5 * 3 = 15');
    const para = target.getJSON().content?.[0];
    const marks = (para?.content ?? []).flatMap(
      (n: { marks?: { type: string }[] }) => (n.marks ?? []).map((m) => m.type),
    );
    expect(marks).toEqual([]);
  });

  it('keeps snake_case identifiers and file paths literal', () => {
    const target = buildEditor();
    target.commands.focus();
    paste(target, {
      plain: 'snake_case_name and path/to/file.ts',
      html: '',
    });
    expect(target.getText()).toBe('snake_case_name and path/to/file.ts');
  });

  it('pastes plain prose verbatim', () => {
    const target = buildEditor();
    target.commands.focus();
    paste(target, {
      plain: 'Just some prose with no special shape.',
      html: '',
    });
    expect(blockTypes(target)).toEqual(['paragraph']);
    expect(target.getText()).toBe('Just some prose with no special shape.');
  });

  it('Cmd/Ctrl+Shift+V bypasses markdown rendering (literal characters)', () => {
    const target = buildEditor();
    target.commands.focus();
    paste(
      target,
      { plain: '# Heading with **bold**', html: '' },
      { forcePlainText: true },
    );
    expect(blockTypes(target)).toEqual(['paragraph']);
    expect(target.getText()).toContain('# Heading with **bold**');
  });

  it('pastes a partial code selection into a paragraph as literal text', () => {
    const source = buildEditor('```markdown\n# heading\n- item\n```');
    selectCodeText(source, 0, '# heading'.length);
    const payload = copySelection(source);
    const target = buildEditor('before  after');
    setCursorAfter(target, 'before ');

    paste(target, payload);

    expect(blockTypes(target)).toEqual(['paragraph']);
    expect(target.getText()).toBe('before # heading after');
  });

  it('pastes a partial code selection into an empty paragraph as literal text', () => {
    const source = buildEditor('```markdown\n# heading\n- item\n```');
    selectCodeText(source, 0, '# heading'.length);
    const payload = copySelection(source);
    const target = buildEditor();
    target.commands.focus('start');

    paste(target, payload);

    expect(blockTypes(target)).toEqual(['paragraph']);
    expect(target.getText()).toBe('# heading');
  });

  it('pastes a complete code text selection into a paragraph without rendering markdown', () => {
    const source = buildEditor('```markdown\n# heading\n- item\n```');
    selectCodeText(source);
    const payload = copySelection(source);
    const target = buildEditor('before  after');
    setCursorAfter(target, 'before ');

    paste(target, payload);

    expect(blockTypes(target)).toEqual(['paragraph']);
    expect(target.getText()).toContain('# heading\n- item');
    expect(blockTypes(target)).not.toContain('heading');
    expect(blockTypes(target)).not.toContain('bulletList');
  });

  it('pastes a partial code selection inside code without splitting it', () => {
    const source = buildEditor('```markdown\n# heading\n- item\n```');
    selectCodeText(source, 0, '# heading'.length);
    const payload = copySelection(source);
    const target = buildEditor('```ts\nbefore  after\n```');
    setCursorAfter(target, 'before ');

    paste(target, payload);

    const codeBlocks = (target.getJSON().content ?? []).filter(
      (node: { type: string }) => node.type === 'codeBlock',
    );
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]?.attrs?.language).toBe('ts');
    expect(firstTextContent(codeBlocks[0])).toBe('before # heading after');
    expect(blockTypes(target)).not.toContain('heading');
  });

  it('pastes complete code text inside another code block without splitting it', () => {
    const source = buildEditor('```markdown\n# heading\n- item\n```');
    selectCodeText(source);
    const payload = copySelection(source);
    const target = buildEditor('```ts\nbefore  after\n```');
    setCursorAfter(target, 'before ');

    paste(target, payload);

    const codeBlocks = (target.getJSON().content ?? []).filter(
      (node: { type: string }) => node.type === 'codeBlock',
    );
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]?.attrs?.language).toBe('ts');
    expect(firstTextContent(codeBlocks[0])).toBe(
      'before # heading\n- item after',
    );
    expect(blockTypes(target)).not.toContain('heading');
    expect(blockTypes(target)).not.toContain('bulletList');
  });

  it('preserves a copied code block node and its language outside code', () => {
    const source = buildEditor('```ts\nconst answer = 42;\n```');
    const codePos = findNodePos(source, 'codeBlock');
    source.view.dispatch(
      source.state.tr.setSelection(
        NodeSelection.create(source.state.doc, codePos),
      ),
    );
    const payload = copySelection(source);
    const target = buildEditor();

    paste(target, payload);

    const codeBlock = target.getJSON().content?.find(
      (node: { type: string }) => node.type === 'codeBlock',
    );
    expect(codeBlock?.attrs?.language).toBe('ts');
    expect(firstTextContent(codeBlock)).toBe('const answer = 42;');
  });

  it('pastes a copied code block node into code as raw text using the target language', () => {
    const source = buildEditor('```python\nprint("copied")\n```');
    const sourcePos = findNodePos(source, 'codeBlock');
    source.view.dispatch(
      source.state.tr.setSelection(
        NodeSelection.create(source.state.doc, sourcePos),
      ),
    );
    const payload = copySelection(source);
    const target = buildEditor('```ts\nbefore  after\n```');
    setCursorAfter(target, 'before ');

    paste(target, payload);

    const codeBlocks = (target.getJSON().content ?? []).filter(
      (node: { type: string }) => node.type === 'codeBlock',
    );
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]?.attrs?.language).toBe('ts');
    expect(firstTextContent(codeBlocks[0])).toBe(
      'before print("copied") after',
    );
  });

  it('preserves mixed document structure on an internal select-all round trip', () => {
    const source = buildEditor(
      '# Title\n\n- one\n- two\n\n```ts\nconst answer = 42;\n```\n\nAfter',
    );
    source.commands.selectAll();
    const payload = copySelection(source);
    const target = buildEditor();

    paste(target, payload);

    expect(blockTypes(target)).toEqual(
      expect.arrayContaining(['heading', 'bulletList', 'codeBlock', 'paragraph']),
    );
    const codeBlock = target.getJSON().content?.find(
      (node: { type: string }) => node.type === 'codeBlock',
    );
    expect(codeBlock?.attrs?.language).toBe('ts');
  });

  it('keeps external fenced markdown literal when pasted inside code', () => {
    const target = buildEditor('```js\nbefore  after\n```');
    setCursorAfter(target, 'before ');

    paste(target, {
      plain: '```ts\nconst value = 1;\n```',
      html: '',
    });

    const codeBlocks = (target.getJSON().content ?? []).filter(
      (node: { type: string }) => node.type === 'codeBlock',
    );
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]?.attrs?.language).toBe('js');
    expect(firstTextContent(codeBlocks[0])).toContain(
      '```ts\nconst value = 1;\n```',
    );
  });

  it('renders external fenced markdown as a code block outside code', () => {
    const target = buildEditor();

    paste(target, {
      plain: '```ts\nconst value = 1;\n```',
      html: '',
    });

    const codeBlock = target.getJSON().content?.find(
      (node: { type: string }) => node.type === 'codeBlock',
    );
    expect(codeBlock?.attrs?.language).toBe('ts');
    expect(firstTextContent(codeBlock)).toBe('const value = 1;');
  });

  it('keeps forced plain text ahead of an internal code-block slice', () => {
    const source = buildEditor('```ts\n# literal\n```');
    const codePos = findNodePos(source, 'codeBlock');
    source.view.dispatch(
      source.state.tr.setSelection(
        NodeSelection.create(source.state.doc, codePos),
      ),
    );
    const payload = copySelection(source);
    const target = buildEditor();

    paste(target, payload, { forcePlainText: true });

    expect(blockTypes(target)).toEqual(['paragraph']);
    expect(target.getText()).toContain('# literal');
  });

  it('creates a properties atom only when front matter is pasted at the document start', () => {
    const target = buildEditor();
    target.commands.focus('start');

    paste(target, { plain: obsidianFixture, html: '' });

    expect(blockTypes(target)[0]).toBe('frontMatter');
    expect(target.getMarkdown().startsWith(obsidianFixture)).toBe(true);
  });

  it('keeps pasted front matter literal inside the document body', () => {
    const target = buildEditor('Before after');
    setCursorAfter(target, 'Before ');

    paste(target, { plain: obsidianFixture, html: '' });

    expect(blockTypes(target)).not.toContain('frontMatter');
    expect(target.getText()).toContain('title:');
  });
});
