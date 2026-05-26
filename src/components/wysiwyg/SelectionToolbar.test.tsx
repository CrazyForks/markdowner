import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelectionToolbar } from './SelectionToolbar';

function createSelectionEditor({
  inCodeBlock = false,
  empty = false,
}: { inCodeBlock?: boolean; empty?: boolean } = {}) {
  const handlers = new Map<string, Set<() => void>>();
  const dom = document.createElement('div');

  const editor: any = {
    isActive: vi.fn((name: string) => (name === 'codeBlock' ? inCodeBlock : false)),
    state: {
      selection: {
        from: 2,
        to: empty ? 2 : 6,
        empty,
      },
    },
    view: {
      dom,
      hasFocus: () => true,
      coordsAtPos: () => ({ top: 80, bottom: 100, left: 40, right: 60 }),
    },
    chain: () => ({
      focus: () => ({
        toggleBold: () => ({ run: vi.fn() }),
        toggleItalic: () => ({ run: vi.fn() }),
        toggleStrike: () => ({ run: vi.fn() }),
        toggleCode: () => ({ run: vi.fn() }),
        extendMarkRange: () => ({ setLink: () => ({ run: vi.fn() }) }),
      }),
    }),
    on: vi.fn((name: string, handler: () => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(handler);
    }),
    off: vi.fn((name: string, handler: () => void) => {
      handlers.get(name)?.delete(handler);
    }),
    emit: (name: string) => {
      handlers.get(name)?.forEach((handler) => handler());
    },
  };

  return editor;
}

describe('SelectionToolbar', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the formatting toolbar for an inline selection outside a code block', async () => {
    const editor = createSelectionEditor({ inCodeBlock: false });

    render(<SelectionToolbar editor={editor} />);
    act(() => {
      editor.emit('selectionUpdate');
    });

    expect(
      await screen.findByRole('toolbar', { name: /text formatting/i }),
    ).toBeInTheDocument();
  });

  it('hides the toolbar when the selection is inside a code block', async () => {
    // Bold / italic / strike / inline-code / link cannot be applied inside
    // a code block — the schema rejects them. Showing buttons that silently
    // do nothing on click would read as "the editor is broken".
    const editor = createSelectionEditor({ inCodeBlock: true });

    render(<SelectionToolbar editor={editor} />);
    act(() => {
      editor.emit('selectionUpdate');
    });

    // Wait a microtask + RAF for the toolbar to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => {
      expect(screen.queryByRole('toolbar', { name: /text formatting/i })).toBeNull();
    });
  });

  it('hides the toolbar when the selection collapses', async () => {
    const editor = createSelectionEditor({ empty: true });

    render(<SelectionToolbar editor={editor} />);
    act(() => {
      editor.emit('selectionUpdate');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('toolbar', { name: /text formatting/i })).toBeNull();
  });
});
