import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchPanel, type SearchResultFile } from './SearchPanel';
import type { FindReplaceOptions } from '@/lib/findReplace';

const defaultOptions: FindReplaceOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

const searchResults: SearchResultFile[] = [
  {
    path: '/tmp/project/guides/alpha.md',
    matches: [
      {
        line: 3,
        column: 5,
        preview: 'Alpha heading',
        matchStart: 0,
        matchEnd: 5,
        absoluteOffset: 12,
      },
    ],
  },
];

function renderSearchPanel(
  overrides: Partial<Parameters<typeof SearchPanel>[0]> = {},
) {
  const props = {
    query: '',
    options: defaultOptions,
    results: [] as SearchResultFile[],
    busy: false,
    error: null as string | null,
    hasRun: false,
    autoFocusToken: 0,
    rootDir: '/tmp/project',
    onQueryChange: vi.fn(),
    onOptionsChange: vi.fn(),
    onRunSearch: vi.fn(),
    onSelectMatch: vi.fn(),
    displayFileName: (path: string) => path.split('/').pop() ?? path,
    displayWorkspacePath: (path: string, rootDir: string | null) =>
      rootDir ? path.replace(`${rootDir}/`, '') : path,
    ...overrides,
  };

  render(<SearchPanel {...props} />);
  return props;
}

describe('SearchPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('updates the query and runs search on Enter', () => {
    const props = renderSearchPanel({ query: 'alpha' });

    const input = screen.getByTestId('sidebar-search-input');
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onQueryChange).toHaveBeenCalledWith('beta');
    expect(props.onRunSearch).toHaveBeenCalled();
  });

  it('toggles search options without changing unrelated options', () => {
    const props = renderSearchPanel({
      options: { ...defaultOptions, wholeWord: true },
    });

    fireEvent.click(screen.getByRole('button', { name: /match case/i }));
    fireEvent.click(screen.getByRole('button', { name: /whole word/i }));

    expect(props.onOptionsChange).toHaveBeenNthCalledWith(1, {
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });
    expect(props.onOptionsChange).toHaveBeenNthCalledWith(2, {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
  });

  it('renders result summaries, highlighted previews, and selection callbacks', () => {
    const props = renderSearchPanel({
      query: 'alpha',
      hasRun: true,
      results: searchResults,
    });

    expect(screen.getByTestId('sidebar-search-summary')).toHaveTextContent(
      '1 result in 1 file',
    );
    expect(screen.getByText('alpha.md')).toBeInTheDocument();
    expect(screen.getByText('guides/alpha.md')).toBeInTheDocument();
    expect(screen.getByText('Alpha').tagName).toBe('MARK');

    fireEvent.click(screen.getByTestId('sidebar-search-match'));

    expect(props.onSelectMatch).toHaveBeenCalledWith(
      searchResults[0],
      searchResults[0].matches[0],
    );
  });

  it('renders busy, error, empty, and initial states', () => {
    const { rerender } = render(
      <SearchPanel
        query=""
        options={defaultOptions}
        results={[]}
        busy={false}
        error={null}
        hasRun={false}
        autoFocusToken={0}
        rootDir={null}
        onQueryChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onRunSearch={vi.fn()}
        onSelectMatch={vi.fn()}
        displayFileName={(path) => path}
        displayWorkspacePath={(path) => path}
      />,
    );

    expect(screen.getByText(/type to search workspace/i)).toBeInTheDocument();

    rerender(
      <SearchPanel
        query="alpha"
        options={defaultOptions}
        results={[]}
        busy
        error={null}
        hasRun={false}
        autoFocusToken={0}
        rootDir={null}
        onQueryChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onRunSearch={vi.fn()}
        onSelectMatch={vi.fn()}
        displayFileName={(path) => path}
        displayWorkspacePath={(path) => path}
      />,
    );
    expect(screen.getByText('Searching…')).toBeInTheDocument();

    rerender(
      <SearchPanel
        query="alpha"
        options={defaultOptions}
        results={[]}
        busy={false}
        error="Search failed"
        hasRun
        autoFocusToken={0}
        rootDir={null}
        onQueryChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onRunSearch={vi.fn()}
        onSelectMatch={vi.fn()}
        displayFileName={(path) => path}
        displayWorkspacePath={(path) => path}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Search failed');

    rerender(
      <SearchPanel
        query="alpha"
        options={defaultOptions}
        results={[]}
        busy={false}
        error={null}
        hasRun
        autoFocusToken={0}
        rootDir={null}
        onQueryChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onRunSearch={vi.fn()}
        onSelectMatch={vi.fn()}
        displayFileName={(path) => path}
        displayWorkspacePath={(path) => path}
      />,
    );
    expect(within(screen.getByTestId('sidebar-search-panel')).getByText('No results')).toBeInTheDocument();
  });
});
