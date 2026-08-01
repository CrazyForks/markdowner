import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../tests/fixtures/obsidian-frontmatter.md?raw';
import { FrontMatterView } from './FrontMatterView';

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
    <section {...props}>{children}</section>
  ),
}));

vi.mock('@/lib/desktop', () => ({ openExternalUrl }));

function renderView(raw = fixture) {
  const updateAttributes = vi.fn();
  render(
    <FrontMatterView
      node={{ attrs: { raw } } as any}
      updateAttributes={updateAttributes}
      editor={{} as any}
      getPos={vi.fn() as any}
      decorations={[] as any}
      selected={false}
      extension={{} as any}
      view={{} as any}
      innerDecorations={[] as any}
      HTMLAttributes={{}}
      deleteNode={vi.fn() as any}
    />,
  );
  return updateAttributes;
}

afterEach(() => {
  cleanup();
  openExternalUrl.mockReset();
});

describe('FrontMatterView', () => {
  it('shows a compact summary and expands all clipping properties', () => {
    renderView();

    const disclosure = screen.getByRole('button', { name: /Properties/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure).toHaveTextContent('AI가 코드를 짜주는 시대에');
    expect(disclosure).toHaveTextContent('clippings');
    expect(screen.queryByText('description')).not.toBeInTheDocument();

    fireEvent.click(disclosure);
    for (const key of ['title', 'source', 'author', 'published', 'created', 'description', 'tags']) {
      expect(screen.getByText(key)).toBeVisible();
    }
    expect(screen.getByText('[[Career]]')).toBeVisible();
  });

  it('opens source safely and edits only the description value range', () => {
    const updateAttributes = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Properties/ }));
    fireEvent.click(screen.getByRole('button', { name: /medium\.com/ }));
    expect(openExternalUrl).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/medium\.com/));

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    const input = screen.getByRole('textbox', { name: 'Edit description' });
    fireEvent.change(input, { target: { value: 'Expanded' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(updateAttributes).toHaveBeenCalledWith(expect.objectContaining({
      raw: fixture.replace('description: "More"', 'description: "Expanded"'),
      valid: true,
    }));
  });

  it('uses raw mode for ambiguous YAML and keeps Escape non-mutating', () => {
    const raw = '---\nbody: |\n  text\n---\n';
    const updateAttributes = renderView(raw);
    fireEvent.click(screen.getByRole('button', { name: /Properties/ }));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add property' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit raw front matter' }));
    const textarea = screen.getByRole('textbox', { name: 'Raw front matter' });
    fireEvent.change(textarea, { target: { value: `${raw}\n` } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(updateAttributes).not.toHaveBeenCalled();
  });
});
