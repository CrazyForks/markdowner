import { Editor, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  publishEditorEvent,
  subscribeEditorEvent,
} from '@/lib/editorEvents';
import { WYSIWYG_LINK_OPTIONS } from '@/lib/wysiwygLinkOptions';

import { LinkPopup } from './LinkPopup';

function linkAt(editor: Editor): { text: string; href: string } | null {
  let found: { text: string; href: string } | null = null;
  editor.state.doc.descendants(node => {
    const mark = node.marks.find(candidate => candidate.type.name === 'link');
    if (mark && !found) {
      found = {
        text: node.text ?? '',
        href: typeof mark.attrs.href === 'string' ? mark.attrs.href : '',
      };
    }
  });
  return found;
}

async function flushPopupFrame() {
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  });
}

describe('LinkPopup', () => {
  let editor: Editor;
  let host: HTMLDivElement;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    host.setAttribute('data-testid', 'editor-host');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ link: WYSIWYG_LINK_OPTIONS, codeBlock: false }),
      ],
      content: '<p><a href="https://old.example">docs</a> tail</p>',
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      top: 100,
      bottom: 116,
      left: 40,
      right: 80,
    });
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    editor.destroy();
    host.remove();
    vi.restoreAllMocks();
  });

  function replaceContent(content: Content, position: number) {
    editor.commands.setContent(content);
    editor.commands.setTextSelection(position);
  }

  async function openInspection(position = 3) {
    render(<LinkPopup editor={editor} enabled />);
    act(() => publishEditorEvent('link:inspect-request', { position }));
    return screen.findByRole('dialog', { name: 'Link details' });
  }

  async function openEditor() {
    await openInspection();
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    return screen.findByRole('dialog', { name: 'Edit link' });
  }

  async function openCreator(position = 8) {
    editor.commands.setTextSelection(position);
    render(<LinkPopup editor={editor} enabled />);
    act(() => publishEditorEvent('link:edit-request', {}));
    return screen.findByRole('dialog', { name: 'Add link' });
  }

  it('does not open from caret movement or hover', async () => {
    render(<LinkPopup editor={editor} enabled />);
    await act(async () => editor.commands.setTextSelection(3));
    fireEvent.mouseOver(host.querySelector('a')!);
    await flushPopupFrame();

    expect(screen.queryByTestId('link-popup')).toBeNull();
  });

  it('opens a create form without changing the document', async () => {
    replaceContent('<p>Before after</p>', 8);
    const before = editor.getHTML();

    await openCreator();

    expect(screen.getByRole('textbox', { name: 'Display text (optional)' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Link URL' })).toHaveValue('');
    expect(editor.getHTML()).toBe(before);
  });

  it('opens an inspection card only from an explicit event', async () => {
    await openInspection();

    expect(screen.getByText('https://old.example')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Link URL' })).toBeNull();
    expect(editor.state.selection).toMatchObject({ from: 1, to: 5 });
  });

  it('publishes the inspected URL only from Open link', async () => {
    const opened = vi.fn();
    const unsubscribe = subscribeEditorEvent('link:open', opened);
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));

    expect(opened).toHaveBeenCalledWith({
      href: 'https://old.example',
      openInNewTab: false,
    });
    unsubscribe();
  });

  it('does not publish an unsafe stored URL from Open link', async () => {
    const linkType = editor.state.schema.marks.link;
    editor.view.dispatch(
      editor.state.tr.addMark(
        1,
        5,
        linkType.create({ href: 'javascript:alert(1)' }),
      ),
    );
    const opened = vi.fn();
    const unsubscribe = subscribeEditorEvent('link:open', opened);
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));

    expect(opened).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'This link URL cannot be opened',
    );
    expect(screen.getByRole('dialog', { name: 'Link details' })).toBeInTheDocument();
    unsubscribe();
  });

  it('copies the URL and announces success', async () => {
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    expect(writeText).toHaveBeenCalledWith('https://old.example');
    expect(await screen.findByRole('status')).toHaveTextContent('URL copied');
  });

  it('keeps the card open and announces a clipboard failure', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not copy URL',
    );
    expect(screen.getByRole('dialog', { name: 'Link details' })).toBeInTheDocument();
  });

  it('transitions from inspection to an editor with populated fields', async () => {
    await openEditor();

    expect(screen.getByRole('textbox', { name: 'Display text (optional)' })).toHaveValue('docs');
    expect(screen.getByRole('textbox', { name: 'Link URL' })).toHaveValue(
      'https://old.example',
    );
  });

  it('applies a new link using the URL when display text is blank', async () => {
    replaceContent(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Before  after' }],
          },
        ],
      },
      8,
    );
    await openCreator();
    fireEvent.change(screen.getByRole('textbox', { name: 'Link URL' }), {
      target: { value: ' https://example.com ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(linkAt(editor)).toEqual({
      text: 'https://example.com',
      href: 'https://example.com',
    });
    expect(editor.getText()).toBe('Before https://example.com after');
    expect(screen.queryByTestId('link-popup')).toBeNull();
  });

  it('applies both edited fields to an existing link', async () => {
    await openEditor();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Display text (optional)' }),
      { target: { value: 'Guides' } },
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Link URL' }), {
      target: { value: 'https://new.example/guides' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(linkAt(editor)).toEqual({
      text: 'Guides',
      href: 'https://new.example/guides',
    });
    expect(editor.getText()).toBe('Guides tail');
  });

  it('removes the link without removing its text', async () => {
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));

    expect(linkAt(editor)).toBeNull();
    expect(editor.getText()).toBe('docs tail');
  });

  it.each([
    ['Cancel', 'cancel'],
    ['Escape', 'escape'],
    ['outside click', 'outside'],
    ['blur', 'blur'],
  ])('preserves the source byte-for-byte on %s', async (_label, action) => {
    const before = editor.getHTML();
    await openEditor();
    const url = screen.getByRole('textbox', { name: 'Link URL' });
    fireEvent.change(url, { target: { value: 'https://unsaved.example' } });

    if (action === 'cancel') {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    } else if (action === 'escape') {
      fireEvent.keyDown(url, { key: 'Escape' });
    } else if (action === 'outside') {
      fireEvent.mouseDown(document.body);
    } else {
      fireEvent.blur(url, { relatedTarget: document.body });
    }

    expect(screen.queryByTestId('link-popup')).toBeNull();
    expect(editor.getHTML()).toBe(before);
  });

  it('keeps drafts visible and shows an inline invalid URL error', async () => {
    await openEditor();
    const url = screen.getByRole('textbox', { name: 'Link URL' });
    fireEvent.change(url, { target: { value: 'javascript:alert(1)' } });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('status')).toHaveTextContent('Enter a valid link URL');
    expect(url).toHaveValue('javascript:alert(1)');
    expect(linkAt(editor)).toEqual({ text: 'docs', href: 'https://old.example' });
  });

  it('keeps the form open and asks for an empty URL', async () => {
    const before = editor.getHTML();
    await openCreator(8);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('status')).toHaveTextContent('Enter a link URL');
    expect(screen.getByRole('dialog', { name: 'Add link' })).toBeInTheDocument();
    expect(editor.getHTML()).toBe(before);
  });

  it('closes instead of applying after a document-changing transaction', async () => {
    await openEditor();
    act(() => editor.view.dispatch(editor.state.tr.insertText('new ', 1)));

    expect(screen.queryByTestId('link-popup')).toBeNull();
    expect(linkAt(editor)).toEqual({ text: 'docs', href: 'https://old.example' });
  });

  it('closes immediately when disabled', async () => {
    const view = render(<LinkPopup editor={editor} enabled />);
    act(() => publishEditorEvent('link:inspect-request', { position: 3 }));
    expect(await screen.findByTestId('link-popup')).toBeInTheDocument();

    view.rerender(<LinkPopup editor={editor} enabled={false} />);

    expect(screen.queryByTestId('link-popup')).toBeNull();
  });

  it('places the card above when there is enough room', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(48);
    await openInspection();

    expect(screen.getByTestId('link-popup')).toHaveAttribute(
      'data-placement',
      'above',
    );
  });

  it('places the card below when there is not enough room above', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80);
    vi.mocked(editor.view.coordsAtPos).mockReturnValue({
      top: 10,
      bottom: 26,
      left: 40,
      right: 80,
    });
    await openInspection();

    expect(screen.getByTestId('link-popup')).toHaveAttribute(
      'data-placement',
      'below',
    );
  });

  it.each([
    ['Tab', false],
    ['Shift+Tab', true],
  ])('closes without mutation when %s leaves the form', async (_label, shiftKey) => {
    const before = editor.getHTML();
    await openEditor();
    const target = shiftKey
      ? screen.getByRole('textbox', { name: 'Display text (optional)' })
      : screen.getByRole('button', { name: 'Cancel' });
    target.focus();

    fireEvent.keyDown(target, { key: 'Tab', shiftKey });

    expect(screen.queryByTestId('link-popup')).toBeNull();
    expect(editor.getHTML()).toBe(before);
  });
});
