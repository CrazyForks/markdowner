import { describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';

import {
  buildPlainTextPasteSlice,
  handleWysiwygPlainTextPaste,
  isPlainTextPasteRequest,
  parsedDocHasFormatting,
} from './wysiwygPaste';

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
  marks: {
    link: {
      attrs: { href: { default: null } },
      inclusive: false,
      toDOM: (mark) => ['a', { href: mark.attrs.href as string }, 0],
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

  it('wraps URLs in link marks so pasted URLs become clickable links', () => {
    const slice = buildPlainTextPasteSlice(
      schema,
      'see https://example.com for docs',
    );
    const para = slice.content.firstChild!;
    // Three children: "see ", link("https://example.com"), " for docs"
    expect(para.childCount).toBe(3);
    expect(para.child(0).textContent).toBe('see ');
    expect(para.child(0).marks).toHaveLength(0);
    expect(para.child(1).textContent).toBe('https://example.com');
    expect(para.child(1).marks).toHaveLength(1);
    expect(para.child(1).marks[0]?.type.name).toBe('link');
    expect(para.child(1).marks[0]?.attrs.href).toBe('https://example.com');
    expect(para.child(2).textContent).toBe(' for docs');
    expect(para.child(2).marks).toHaveLength(0);
  });

  it('keeps trailing punctuation outside the auto-linked URL', () => {
    // "see https://example.com." — period should not be part of the link.
    const slice = buildPlainTextPasteSlice(schema, 'see https://example.com.');
    const para = slice.content.firstChild!;
    expect(para.child(1).textContent).toBe('https://example.com');
    expect(para.child(2).textContent).toBe('.');
  });

  it('auto-links mailto: and tel: schemes alongside http(s)', () => {
    const slice = buildPlainTextPasteSlice(
      schema,
      'mail mailto:a@b.com or tel:+15555550199',
    );
    const para = slice.content.firstChild!;
    const linkNodes = [];
    for (let i = 0; i < para.childCount; i++) {
      if (para.child(i).marks.some((m) => m.type.name === 'link')) {
        linkNodes.push(para.child(i).textContent);
      }
    }
    expect(linkNodes).toEqual(['mailto:a@b.com', 'tel:+15555550199']);
  });

  it('does not link bare words that lack an explicit scheme', () => {
    // "example.com" without a scheme stays as plain text — conservative on
    // purpose so domain-like filenames (e.g. `package.json`) aren't linked.
    const slice = buildPlainTextPasteSlice(schema, 'visit example.com today');
    const para = slice.content.firstChild!;
    expect(para.childCount).toBe(1);
    expect(para.child(0).marks).toHaveLength(0);
    expect(para.child(0).textContent).toBe('visit example.com today');
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

  // A parsed doc carrying real formatting (here a heading) means the user
  // pasted markdown source — hand it to insertContent so they get formatted
  // blocks instead of literal `# Title` characters.
  const headingDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    ],
  };
  // A plain paragraph is indistinguishable from a plain-text paste — the
  // markdown path must decline so we don't, e.g., turn "5 * 3 = 15" into italic.
  const plainParagraphDoc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '5 * 3 = 15' }] }],
  };

  it('renders pasted text as markdown when the parsed doc carries formatting', () => {
    const { view, dispatch } = makeView();
    const insertContent = vi.fn().mockReturnValue(true);
    const parse = vi.fn().mockReturnValue(headingDoc);
    const editor = {
      storage: { markdown: { manager: { parse, hasMarked: () => true } } },
      commands: { insertContent },
    } as any;
    const handled = handleWysiwygPlainTextPaste(
      view as any,
      makeEvent({ 'text/plain': '# Title' }),
      editor,
    );
    expect(handled).toBe(true);
    expect(parse).toHaveBeenCalledWith('# Title');
    expect(insertContent).toHaveBeenCalledWith(headingDoc);
    // Plain-text path must NOT run when markdown handled it.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('falls through to plain text when the parsed doc has no formatting', () => {
    // The asterisk in "5 * 3 = 15" is not emphasis; marked yields a plain
    // paragraph, so we must paste it verbatim rather than via insertContent.
    const { view, dispatch } = makeView();
    const insertContent = vi.fn();
    const parse = vi.fn().mockReturnValue(plainParagraphDoc);
    const editor = {
      storage: { markdown: { manager: { parse, hasMarked: () => true } } },
      commands: { insertContent },
    } as any;
    const handled = handleWysiwygPlainTextPaste(
      view as any,
      makeEvent({ 'text/plain': '5 * 3 = 15' }),
      editor,
    );
    expect(handled).toBe(true);
    expect(insertContent).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('falls back to plain text when the markdown manager throws', () => {
    const { view, dispatch } = makeView();
    const parse = vi.fn().mockImplementation(() => {
      throw new Error('lex failed');
    });
    const editor = {
      storage: { markdown: { manager: { parse, hasMarked: () => true } } },
      commands: { insertContent: vi.fn() },
    } as any;
    const handled = handleWysiwygPlainTextPaste(
      view as any,
      makeEvent({ 'text/plain': '# Title' }),
      editor,
    );
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('forcePlainText bypasses markdown rendering and pastes verbatim', () => {
    // Cmd/Ctrl+Shift+V: even unambiguous markdown must land as literal
    // characters so the user gets the raw text they asked for.
    const { view, dispatch } = makeView();
    const insertContent = vi.fn().mockReturnValue(true);
    const parse = vi.fn().mockReturnValue(headingDoc);
    const editor = {
      storage: { markdown: { manager: { parse, hasMarked: () => true } } },
      commands: { insertContent },
    } as any;
    const handled = handleWysiwygPlainTextPaste(
      view as any,
      makeEvent({ 'text/plain': '# Title' }),
      editor,
      true,
    );
    expect(handled).toBe(true);
    expect(parse).not.toHaveBeenCalled();
    expect(insertContent).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('parsedDocHasFormatting', () => {
  it('returns false for null / undefined / non-objects', () => {
    expect(parsedDocHasFormatting(null)).toBe(false);
    expect(parsedDocHasFormatting(undefined)).toBe(false);
    expect(parsedDocHasFormatting('text')).toBe(false);
  });

  it('returns false for a single plain paragraph', () => {
    expect(
      parsedDocHasFormatting({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
      }),
    ).toBe(false);
  });

  it('returns false for multiple plain paragraphs (blank-line separated text)', () => {
    expect(
      parsedDocHasFormatting({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
        ],
      }),
    ).toBe(false);
  });

  it('treats hard breaks inside a paragraph as plain text', () => {
    expect(
      parsedDocHasFormatting({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'a' },
              { type: 'hardBreak' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it('returns true when any text node carries a mark', () => {
    expect(
      parsedDocHasFormatting({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
          },
        ],
      }),
    ).toBe(true);
  });

  it('returns true for non-paragraph block nodes (heading, list, table)', () => {
    for (const block of ['heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'table']) {
      expect(
        parsedDocHasFormatting({ type: 'doc', content: [{ type: block }] }),
      ).toBe(true);
    }
  });
});

describe('isPlainTextPasteRequest', () => {
  it('is true when shift is held and the last key was not Insert', () => {
    expect(isPlainTextPasteRequest({ input: { shiftKey: true, lastKeyCode: 86 } })).toBe(true);
  });

  it('is false without shift', () => {
    expect(isPlainTextPasteRequest({ input: { shiftKey: false, lastKeyCode: 86 } })).toBe(false);
  });

  it('is false for Shift+Insert (lastKeyCode 45)', () => {
    expect(isPlainTextPasteRequest({ input: { shiftKey: true, lastKeyCode: 45 } })).toBe(false);
  });

  it('is false when the view exposes no input state', () => {
    expect(isPlainTextPasteRequest({})).toBe(false);
    expect(isPlainTextPasteRequest({ input: undefined })).toBe(false);
  });
});

