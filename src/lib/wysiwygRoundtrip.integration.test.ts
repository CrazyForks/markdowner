/**
 * Integration test that drives the real @tiptap/core + @tiptap/markdown stack
 * and confirms the "open file → no edits → save preserves the original bytes"
 * contract holds even for content shapes the markdown serialiser can't
 * losslessly round-trip on its own.
 *
 * This is the safety net for the "저장/로드 시 내용 깨짐" class of bugs:
 * raw HTML blocks, tilde-fenced code, `<https://…>` autolinks, escaped
 * backslashes — each one normally mutates between load and save. With the
 * `resolvePersistedWysiwygMarkdown` shim, the editor only commits the
 * normalised form once the user actually authors edits.
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

import { resolvePersistedWysiwygMarkdown } from './wysiwygEditorSync';

const lowlight = createLowlight(common);

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
  });
}

// Simulates the App.tsx load flow: setContent(original) then capture the
// canonical round-trip. Returns the two refs the save path consults.
function loadAndSnapshot(editor: Editor, markdown: string) {
  editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false } as never);
  return { loaded: markdown, canonical: editor.getMarkdown() };
}

interface LossyCase {
  name: string;
  source: string;
}

const LOSSY_CASES: LossyCase[] = [
  {
    name: 'raw HTML block',
    source: '# Title\n\n<details>\n<summary>open</summary>\nbody\n</details>\n',
  },
  {
    name: 'tilde-fenced code',
    source: 'Intro\n\n~~~\nplain code\n~~~\n',
  },
  {
    name: 'angle-bracket autolink',
    source: 'See <https://example.com> for docs.\n',
  },
  {
    name: 'multi-paragraph list item',
    source: '- first item\n\n  follow-up paragraph\n\n- second item\n',
  },
];

describe('WYSIWYG load → no-edit → save preserves original bytes', () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  for (const tc of LOSSY_CASES) {
    it(`preserves the original bytes for: ${tc.name}`, () => {
      editor = buildEditor();
      const { loaded, canonical } = loadAndSnapshot(editor, tc.source);
      // Sanity check the case really is lossy — otherwise the test isn't
      // proving anything.
      expect(canonical).not.toBe(loaded);

      // The user hasn't touched anything. The live serialised markdown
      // equals the canonical round-trip we just captured.
      const current = editor.getMarkdown();
      expect(current).toBe(canonical);

      // The save path must hand the OS the original bytes — not the lossy
      // canonical form.
      const persisted = resolvePersistedWysiwygMarkdown(current, loaded, canonical);
      expect(persisted).toBe(loaded);
    });
  }

  it('still preserves the original bytes for losslessly-round-tripping content (no spurious rewrite)', () => {
    // Pure ATX heading is already a fixed point of the serialiser — the
    // test guards against the resolver pointlessly rewriting EOLs / trailing
    // whitespace.
    editor = buildEditor();
    const source = '# Hello\n\nBody.\n';
    const { loaded, canonical } = loadAndSnapshot(editor, source);
    const persisted = resolvePersistedWysiwygMarkdown(editor.getMarkdown(), loaded, canonical);
    expect(persisted).toBe(loaded);
  });

  it('hands back the live serialised markdown the moment the user authors a change', () => {
    editor = buildEditor();
    const source = '# Title\n\n<details>note</details>\n';
    const { loaded, canonical } = loadAndSnapshot(editor, source);
    // Simulate a user edit at the end of the doc.
    editor.commands.focus('end');
    editor.commands.insertContent('extra text');

    const current = editor.getMarkdown();
    const persisted = resolvePersistedWysiwygMarkdown(current, loaded, canonical);
    // Once the user edits, we accept the lossy serialiser output for the
    // whole document — block-level preservation of untouched lossy regions
    // would need a structural diff layer that lives outside this helper.
    expect(persisted).toBe(current);
    expect(persisted).not.toBe(loaded);
  });
});
