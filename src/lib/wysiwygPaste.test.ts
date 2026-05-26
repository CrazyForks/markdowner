import { describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';

import { buildPlainTextPasteSlice, handleWysiwygPlainTextPaste } from './wysiwygPaste';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
    hardBreak: {
      group: 'inline',
      inline: true,
      selectable: false,
      toDOM: () => ['br'],
    },
  },
});

function paragraph(text: string) {
  return schema.nodes.paragraph.create(null, [schema.text(text)]);
}

describe('buildPlainTextPasteSlice', () => {
  it('returns an open slice with a single paragraph for single-line text', () => {
    const slice = buildPlainTextPasteSlice(schema, 'hello world');
    expect(slice.openStart).toBe(1);
    expect(slice.openEnd).toBe(1);
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.type.name).toBe('paragraph');
    expect(slice.content.firstChild?.textContent).toBe('hello world');
  });

  it('treats blank lines as paragraph separators', () => {
    const slice = buildPlainTextPasteSlice(schema, 'first paragraph\n\nsecond paragraph');
    expect(slice.content.childCount).toBe(2);
    expect(slice.content.child(0).textContent).toBe('first paragraph');
    expect(slice.content.child(1).textContent).toBe('second paragraph');
  });

  it('converts single newlines inside a paragraph into hard breaks', () => {
    const slice = buildPlainTextPasteSlice(schema, 'line one\nline two');
    expect(slice.content.childCount).toBe(1);
    const para = slice.content.child(0);
    expect(para.childCount).toBe(3);
    expect(para.child(0).type.name).toBe('text');
    expect(para.child(1).type.name).toBe('hardBreak');
    expect(para.child(2).type.name).toBe('text');
  });

  it('preserves literal HTML-looking tags verbatim instead of dropping them', () => {
    // Regression for the "paste loses content" bug. ProseMirror's default
    // paste handler would have parsed text/html (when present) and dropped
    // `<SidebarInset>` because the schema cannot map that tag.
    const slice = buildPlainTextPasteSlice(
      schema,
      '@<SidebarInset>\n\n<div class="x">content</div>',
    );
    expect(slice.content.child(0).textContent).toBe('@<SidebarInset>');
    expect(slice.content.child(1).textContent).toBe('<div class="x">content</div>');
  });

  it('normalizes CRLF and lone CR before splitting', () => {
    const slice = buildPlainTextPasteSlice(schema, 'a\r\nb\rc');
    expect(slice.content.childCount).toBe(1);
    const para = slice.content.child(0);
    // a <br> b <br> c — three text nodes, two breaks.
    expect(para.childCount).toBe(5);
    expect(para.textContent).toBe('abc');
  });

  it('returns an empty slice for empty input', () => {
    const slice = buildPlainTextPasteSlice(schema, '');
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.textContent).toBe('');
  });
});

describe('handleWysiwygPlainTextPaste', () => {
  function makeView() {
    const dispatch = vi.fn();
    const view = {
      state: {
        schema,
        tr: {
          replaceSelection: vi.fn(function (this: any) {
            return this;
          }),
          scrollIntoView: vi.fn(function (this: any) {
            return this;
          }),
        },
      },
      dispatch,
    };
    // Make the chain return the same tr object so calls compose.
    view.state.tr.replaceSelection = vi.fn().mockReturnValue(view.state.tr);
    view.state.tr.scrollIntoView = vi.fn().mockReturnValue(view.state.tr);
    return { view, dispatch };
  }

  function makeEvent(data: Record<string, string> | null): ClipboardEvent {
    return {
      clipboardData: data
        ? ({
            getData: (type: string) => data[type] ?? '',
          } as DataTransfer)
        : null,
    } as ClipboardEvent;
  }

  it('inserts the plain-text payload via replaceSelection', () => {
    const { view, dispatch } = makeView();
    const handled = handleWysiwygPlainTextPaste(
      view as any,
      makeEvent({ 'text/plain': 'hello' }),
    );
    expect(handled).toBe(true);
    expect(view.state.tr.replaceSelection).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('falls through when the clipboard has no plain text (image/file paste)', () => {
    const { view, dispatch } = makeView();
    const handled = handleWysiwygPlainTextPaste(
      view as any,
      makeEvent({ 'text/html': '<p>nope</p>' }),
    );
    expect(handled).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('falls through when clipboardData itself is missing', () => {
    const { view, dispatch } = makeView();
    const handled = handleWysiwygPlainTextPaste(view as any, makeEvent(null));
    expect(handled).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores text/html and inserts text/plain verbatim, even when both are present', () => {
    // The whole point of this hook: when a source like react-grab populates
    // text/html with markup that drops unknown tags, ProseMirror's default
    // would lose content. We always prefer text/plain.
    const { view, dispatch } = makeView();
    const plain = '@<SidebarInset>\n\nin SidebarInset (at /src/components/ui/sidebar.tsx)';
    const handled = handleWysiwygPlainTextPaste(
      view as any,
      makeEvent({
        'text/plain': plain,
        'text/html': '<div data-react-grab-frozen=""><SidebarInset></SidebarInset></div>',
      }),
    );
    expect(handled).toBe(true);
    const sliceArg = (view.state.tr.replaceSelection as any).mock.calls[0][0];
    expect(sliceArg.content.child(0).textContent).toBe('@<SidebarInset>');
    expect(sliceArg.content.child(1).textContent).toBe(
      'in SidebarInset (at /src/components/ui/sidebar.tsx)',
    );
  });
});
