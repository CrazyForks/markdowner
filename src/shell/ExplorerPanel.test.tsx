import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExplorerPanel, type OpenEditorItem } from './ExplorerPanel';

const openEditors: OpenEditorItem[] = [
  {
    id: 'tab-1',
    name: 'draft.md',
    path: '/tmp/project/docs/draft.md',
    isActive: true,
    isDirty: true,
    missing: false,
  },
  {
    id: 'tab-2',
    name: 'missing.md',
    path: '/tmp/project/docs/missing.md',
    isActive: false,
    isDirty: false,
    missing: true,
  },
];

function createExplorerPanelProps(
  overrides: Partial<Parameters<typeof ExplorerPanel>[0]> = {},
) {
  const props = {
    busy: false,
    workspaceName: 'project',
    workspaceFilter: '',
    onWorkspaceFilterChange: vi.fn(),
    workspaceTreeLength: 2,
    filteredWorkspaceTreeLength: 2,
    openEditors,
    recentDocuments: ['/tmp/project/docs/draft.md', '/tmp/project/docs/old.md'],
    activeDocumentPath: '/tmp/project/docs/draft.md',
    rootDir: '/tmp/project',
    onNewDocument: vi.fn(),
    onOpenDocument: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onCollapseWorkspaceFolders: vi.fn(),
    onSelectOpenEditor: vi.fn(),
    onCloseOpenEditor: vi.fn(),
    onOpenRecentDocument: vi.fn(),
    renderWorkspaceTreeNodes: () => (
      <>
        <button type="button" data-explorer-row="" onClick={() => props.onOpenRecentDocument('alpha')}>
          alpha.md
        </button>
        <button type="button" data-explorer-row="" onClick={() => props.onOpenRecentDocument('beta')}>
          beta.md
        </button>
      </>
    ),
    displayFileName: (path: string) => path.split('/').pop() ?? path,
    displayWorkspacePath: (path: string, rootDir: string | null) =>
      rootDir ? path.replace(`${rootDir}/`, '') : path,
    ...overrides,
  };

  return props;
}

function renderExplorerPanel(
  overrides: Partial<Parameters<typeof ExplorerPanel>[0]> = {},
) {
  const props = createExplorerPanelProps(overrides);
  render(<ExplorerPanel {...props} />);
  return props;
}

describe('ExplorerPanel', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('renders explorer actions, open editors, workspace, and recent documents', () => {
    const props = renderExplorerPanel();

    expect(screen.getByText('EXPLORER')).toBeInTheDocument();
    expect(screen.getByText('OPEN EDITORS')).toBeInTheDocument();
    expect(screen.getByText('PROJECT')).toBeInTheDocument();
    expect(screen.getByTestId('explorer-open-editors')).toHaveTextContent('draft.md');
    expect(screen.getByText('missing.md')).toHaveClass('line-through');
    expect(screen.getByRole('textbox', { name: /filter files/i })).toHaveClass('h-7');
    expect(screen.getByText('old.md')).toBeInTheDocument();
    expect(screen.getByText('docs/old.md')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /new file/i }));
    fireEvent.click(screen.getByRole('button', { name: /open file/i }));
    fireEvent.click(screen.getByRole('button', { name: /open workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: /collapse all/i }));

    expect(props.onNewDocument).toHaveBeenCalled();
    expect(props.onOpenDocument).toHaveBeenCalled();
    expect(props.onOpenWorkspace).toHaveBeenCalled();
    expect(props.onCollapseWorkspaceFolders).toHaveBeenCalled();
  });

  it('routes editor and recent document actions', () => {
    const props = renderExplorerPanel();

    fireEvent.click(screen.getAllByRole('button', { name: /switch to open editor/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /close open editor/i })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'old.md' }));

    expect(props.onSelectOpenEditor).toHaveBeenCalledWith('tab-1');
    expect(props.onCloseOpenEditor).toHaveBeenCalledWith('tab-2');
    expect(props.onOpenRecentDocument).toHaveBeenCalledWith('/tmp/project/docs/old.md');
  });

  it('collapses sections and persists the collapsed state', () => {
    renderExplorerPanel();

    fireEvent.click(screen.getByRole('button', { name: /open editors/i }));
    expect(screen.queryByTestId('explorer-open-editors')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('markdowner.explorer.collapsedSections')).toContain(
      '"editors":true',
    );
  });

  it('renders workspace empty and filtered-empty states', () => {
    const { rerender } = render(
      <ExplorerPanel
        {...createExplorerPanelProps({
          workspaceTreeLength: 0,
          filteredWorkspaceTreeLength: 0,
          renderWorkspaceTreeNodes: () => null,
        })}
      />,
    );

    expect(screen.getByText(/open a folder to populate the file tree/i)).toBeInTheDocument();

    rerender(
      <ExplorerPanel
        {...createExplorerPanelProps({
          workspaceTreeLength: 1,
          filteredWorkspaceTreeLength: 0,
          renderWorkspaceTreeNodes: () => null,
        })}
      />,
    );

    expect(screen.getByText(/no files match this filter/i)).toBeInTheDocument();
  });

  it('moves row focus with arrows and activates the focused row with Cmd+Down', () => {
    const props = renderExplorerPanel({ openEditors: [] });
    const filter = screen.getByRole('textbox', { name: /filter files/i });
    const alpha = screen.getByRole('button', { name: 'alpha.md' });
    const beta = screen.getByRole('button', { name: 'beta.md' });

    filter.focus();
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(alpha);

    fireEvent.keyDown(alpha, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(beta);

    fireEvent.keyDown(beta, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(alpha);

    fireEvent.keyDown(alpha, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(filter);

    fireEvent.keyDown(alpha, { key: 'ArrowDown', metaKey: true });
    expect(props.onOpenRecentDocument).toHaveBeenCalledWith('alpha');
  });
});
