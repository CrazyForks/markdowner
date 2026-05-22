import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';

import {
  wysiwygCursorMarkdownOffset,
  wysiwygCursorSourceLocation,
  wysiwygPositionAtMarkdownOffset,
} from './modeCursor';

// Smoke tests against a real Tiptap editor with real @tiptap/markdown.
// The App.test.tsx mock fakes Tiptap but can mask serializer-specific
// behaviour. These tests previously failed (every offset came back as 0)
// because getMarkdownSerializer in modeCursor.ts pulled
// `editor.storage.markdown.serializer`, while the live extension exposes
// `editor.storage.markdown.manager.serialize(json)`. That mismatch is
// the root cause of Option+1 → Option+2 dragging the source caret to
// offset 0, since wysiwygCursorMarkdownOffset's catch-all fallback
// returns 0 when the serializer can't be resolved.
function buildEditor(markdown: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, Markdown],
    content: markdown,
    contentType: 'markdown' as never,
  });
}

describe('modeCursor against real Tiptap + Markdown', () => {
  it('returns the markdown offset of a caret inside a heading', () => {
    const editor = buildEditor('# Hello\n\nWorld');
    editor.commands.setTextSelection(3);
    const offset = wysiwygCursorMarkdownOffset(editor);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThanOrEqual('# Hello\n\nWorld'.length);
    editor.destroy();
  });

  it('returns a positive offset and location for a caret in the middle of the doc', () => {
    const editor = buildEditor('# Heading\n\nSome paragraph text that is long enough to test.');
    const docSize = editor.state.doc.content.size;
    const middle = Math.floor(docSize / 2);
    editor.commands.setTextSelection(middle);
    const offset = wysiwygCursorMarkdownOffset(editor);
    const location = wysiwygCursorSourceLocation(editor);
    expect(offset).toBeGreaterThan(0);
    expect(location.line).toBeGreaterThanOrEqual(1);
    expect(location.column).toBeGreaterThanOrEqual(1);
    editor.destroy();
  });

  it('returns positive offsets across a mixed-block document', () => {
    const md = [
      '# Title',
      '',
      'First paragraph with some text.',
      '',
      '- item one',
      '- item two',
      '',
      '> A quote',
      '',
      'Final paragraph here.',
    ].join('\n');
    const editor = buildEditor(md);
    const docSize = editor.state.doc.content.size;
    let positiveOffsetCount = 0;
    for (let pos = 2; pos < docSize - 1; pos += 5) {
      editor.commands.setTextSelection(pos);
      const offset = wysiwygCursorMarkdownOffset(editor);
      if (offset > 0) positiveOffsetCount += 1;
    }
    // Most positions inside non-empty blocks should yield a positive offset.
    // (Boundary positions between blocks legitimately serialize to length 0.)
    expect(positiveOffsetCount).toBeGreaterThan(3);
    editor.destroy();
  });

  it('round-trips: source offset → wysiwyg pos → markdown offset', () => {
    const md = '# Hello\n\nWorld paragraph here.';
    const editor = buildEditor(md);
    const sourceOffset = md.indexOf('World') + 3;
    const pmPos = wysiwygPositionAtMarkdownOffset(editor, sourceOffset);
    expect(pmPos).not.toBeNull();
    if (pmPos !== null) {
      editor.commands.setTextSelection(pmPos);
      const reconstructedOffset = wysiwygCursorMarkdownOffset(editor);
      expect(Math.abs(reconstructedOffset - sourceOffset)).toBeLessThanOrEqual(2);
    }
    editor.destroy();
  });
});
