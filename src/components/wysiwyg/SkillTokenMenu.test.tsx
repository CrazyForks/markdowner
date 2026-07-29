import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillTokenMenu } from './SkillTokenMenu';

function createEditor(textBefore: string) {
  const handlers = new Map<string, Set<() => void>>();
  const dom = document.createElement('div');
  const blockStart = 1;
  const from = blockStart + textBefore.length;
  const chain: any = {
    focus: vi.fn().mockReturnThis(),
    deleteRange: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    run: vi.fn().mockReturnValue(true),
  };

  const editor: any = {
    state: {
      selection: {
        from,
        to: from,
        empty: true,
        $from: {
          depth: 1,
          start: () => blockStart,
          parent: { type: { spec: {} } },
          marks: () => [],
        },
      },
      doc: {
        textBetween: () => textBefore,
      },
    },
    view: {
      dom,
      coordsAtPos: () => ({ top: 24, bottom: 42, left: 18, right: 18 }),
    },
    chain: vi.fn().mockReturnValue(chain),
    commands: { focus: vi.fn() },
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

  return { editor, chain };
}

describe('SkillTokenMenu', () => {
  afterEach(cleanup);

  it('offers slash-prefixed skills in the middle of a WYSIWYG line', async () => {
    const { editor } = createEditor('Run /git');

    render(
      <SkillTokenMenu
        editor={editor}
        skillNames={new Set(['goal', 'git-commit', 'git-commit-push'])}
      />,
    );

    act(() => {
      editor.emit('update');
    });

    expect(
      await screen.findByRole('menuitem', {
        name: /^\/git-commit\s*installed skill$/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', {
        name: /^\/git-commit-push\s*installed skill$/i,
      }),
    ).toBeInTheDocument();
  });

  it('leaves a line-start slash to the unified block and skill menu', async () => {
    const { editor } = createEditor('  /git');

    render(
      <SkillTokenMenu
        editor={editor}
        skillNames={new Set(['git-commit'])}
      />,
    );

    act(() => {
      editor.emit('update');
    });

    await waitFor(() => {
      expect(screen.queryByTestId('skill-token-menu')).not.toBeInTheDocument();
    });
  });

  it('offers dollar-prefixed skills at the start of a line', async () => {
    const { editor } = createEditor('$go');

    render(
      <SkillTokenMenu editor={editor} skillNames={new Set(['goal'])} />,
    );

    act(() => {
      editor.emit('selectionUpdate');
    });

    expect(
      await screen.findByRole('menuitem', { name: /\$goal.*installed skill/i }),
    ).toBeInTheDocument();
  });

  it('replaces the full query and preserves its prefix', async () => {
    const { editor, chain } = createEditor('Run $go');

    render(
      <SkillTokenMenu editor={editor} skillNames={new Set(['goal'])} />,
    );

    act(() => {
      editor.emit('update');
    });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /\$goal.*installed skill/i }),
    );

    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 5, to: 8 });
    expect(chain.insertContent).toHaveBeenCalledWith('$goal');
    expect(chain.run).toHaveBeenCalledTimes(1);
  });

  it('does not open inside inline or block code', async () => {
    const inline = createEditor('Run $go');
    inline.editor.state.selection.$from.marks = () => [
      { type: { name: 'code' } },
    ];
    const block = createEditor('$go');
    block.editor.state.selection.$from.parent.type.spec.code = true;

    const { rerender } = render(
      <SkillTokenMenu
        editor={inline.editor}
        skillNames={new Set(['goal'])}
      />,
    );
    act(() => {
      inline.editor.emit('update');
    });
    expect(screen.queryByTestId('skill-token-menu')).not.toBeInTheDocument();

    rerender(
      <SkillTokenMenu
        editor={block.editor}
        skillNames={new Set(['goal'])}
      />,
    );
    act(() => {
      block.editor.emit('update');
    });
    expect(screen.queryByTestId('skill-token-menu')).not.toBeInTheDocument();
  });

  it('supports arrow navigation and Tab selection from the editor', async () => {
    const { editor, chain } = createEditor('Run /');

    render(
      <SkillTokenMenu
        editor={editor}
        skillNames={new Set(['git-commit', 'goal'])}
      />,
    );
    act(() => {
      editor.emit('update');
    });

    await screen.findByTestId('skill-token-menu');
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });

    expect(chain.insertContent).toHaveBeenCalledWith('/goal');
  });
});
