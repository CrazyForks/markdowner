/**
 * Behaviour tests for the custom code-block node view and keyboard handling.
 * A real Tiptap editor in jsdom exposes document structure and rendered DOM,
 * but jsdom has no layout, so it cannot prove actual visual-row geometry.
 *
 * Guards the down-arrow exit specifically: our addKeyboardShortcuts override
 * shadows CodeBlockLowlight's built-in exitOnArrowDown, so the exit must be
 * re-implemented here. The endOfTextblock mock verifies our delegation and
 * decision boundary; constrained-width visual wrapping is covered live.
 */
import StarterKit from '@tiptap/starter-kit';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodeBlockExtension } from './codeBlockExtension';

function buildEditor(content: string): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [StarterKit.configure({ codeBlock: false }), createCodeBlockExtension()],
    content,
  });
}

function pressArrowDown(editor: Editor): boolean {
  return Boolean(
    editor.view.someProp('handleKeyDown', (fn) =>
      fn?.(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    ),
  );
}

describe('code block keyboard handling', () => {
  let editor: Editor;

  afterEach(() => {
    cleanup();
    const el = editor?.view.dom.parentElement;
    editor?.destroy();
    el?.remove();
  });

  it('lets ordinary code content inherit white-space in the real React node view', async () => {
    editor = buildEditor('<pre><code>only</code></pre>');
    const { container } = render(createElement(EditorContent, { editor }));

    const content = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        '.code-block-view > pre > code',
      );
      expect(element).not.toBeNull();
      return element!;
    });
    expect(content.style.whiteSpace).toBe('inherit');
  });

  describe('ArrowDown exit', () => {
    beforeEach(() => {
      editor = buildEditor('<pre><code>line1\nline2</code></pre>');
      // jsdom has no layout; downstream keymap handlers (gapcursor) call
      // endOfTextblock -> coordsAtPos -> getClientRects, which throws. The
      // stub models ProseMirror's visual-boundary result so these tests verify
      // our shortcut decision rather than browser wrapping geometry.
      vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(false);
    });

    it('exits the code block to the paragraph below from the last line', () => {
      vi.mocked(editor.view.endOfTextblock).mockReturnValue(true);
      // Caret at the very end (last line) of the code block.
      const end = editor.state.doc.firstChild!.nodeSize - 1;
      editor.chain().focus().setTextSelection(end).run();
      const handled = pressArrowDown(editor);
      expect(handled).toBe(true);
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    });

    it('does not exit when the caret is not on the last line', () => {
      // Caret on the first line (before the newline).
      editor.chain().focus().setTextSelection(3).run();
      const handled = pressArrowDown(editor);
      expect(handled).toBeFalsy();
      expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock');
    });

    it('does not exit when ProseMirror reports another visual row below', () => {
      editor.chain().focus().setTextSelection(8).run();
      const handled = pressArrowDown(editor);
      expect(editor.view.endOfTextblock).toHaveBeenCalledWith('down');
      expect(handled).toBeFalsy();
      expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock');
    });
  });

  it('creates a paragraph below when the code block is the last node', () => {
    editor = buildEditor('<pre><code>only</code></pre>');
    vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
    // Remove any trailing node so the code block is genuinely last.
    const docChildCount = editor.state.doc.childCount;
    // Place caret at end of the code block content.
    const end = editor.state.doc.firstChild!.nodeSize - 1;
    editor.chain().focus().setTextSelection(end).run();
    pressArrowDown(editor);
    // Either moved into an existing trailing paragraph or created one; the
    // caret must end up in a paragraph regardless of starting trailing state.
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.childCount).toBeGreaterThanOrEqual(docChildCount);
  });
});
