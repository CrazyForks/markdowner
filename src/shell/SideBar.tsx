import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { FindReplaceOptions } from '@/lib/findReplace';
import type { OutlineItem } from '@/lib/outline';
import {
  SearchPanel,
  type SearchResultFile,
  type SearchResultMatch,
} from './SearchPanel';
import { OutlinePanel } from './OutlinePanel';
import { ExplorerPanel, type OpenEditorItem } from './ExplorerPanel';

export type { SearchResultFile, SearchResultMatch } from './SearchPanel';
export type { OpenEditorItem } from './ExplorerPanel';

export type SideBarPanel = 'files' | 'search' | 'outline';

export interface SideBarProps {
  panel: SideBarPanel;
  isOpen: boolean;
  busy: boolean;
  workspaceName: string | null;
  workspaceFilter: string;
  onWorkspaceFilterChange: (value: string) => void;
  workspaceTreeLength: number;
  filteredWorkspaceTreeLength: number;
  openEditors: OpenEditorItem[];
  recentDocuments: string[];
  activeDocumentPath: string | null;
  rootDir: string | null;
  onNewDocument?: () => void;
  onOpenDocument?: () => void;
  onOpenWorkspace?: () => void;
  onCollapseWorkspaceFolders?: () => void;
  onSelectOpenEditor: (id: string) => void;
  onCloseOpenEditor: (id: string) => void;
  onOpenRecentDocument: (path: string) => void;
  renderWorkspaceTreeNodes: () => ReactNode;
  displayFileName: (path: string) => string;
  displayWorkspacePath: (path: string, rootDir: string | null) => string;
  outlineItems: OutlineItem[];
  outlineFontSize: number;
  outlineRowSpacing: number;
  onSelectOutlineItem?: (item: OutlineItem) => void;
  searchQuery: string;
  searchOptions: FindReplaceOptions;
  searchResults: SearchResultFile[];
  searchBusy: boolean;
  searchError: string | null;
  searchHasRun: boolean;
  searchAutoFocusToken: number;
  onSearchQueryChange: (value: string) => void;
  onSearchOptionsChange: (options: FindReplaceOptions) => void;
  onRunSearch: () => void;
  onSelectSearchMatch: (file: SearchResultFile, match: SearchResultMatch) => void;
}

export function SideBar({
  panel,
  isOpen,
  busy,
  workspaceName,
  workspaceFilter,
  onWorkspaceFilterChange,
  workspaceTreeLength,
  filteredWorkspaceTreeLength,
  openEditors,
  recentDocuments,
  activeDocumentPath,
  rootDir,
  onNewDocument,
  onOpenDocument,
  onOpenWorkspace,
  onCollapseWorkspaceFolders,
  onSelectOpenEditor,
  onCloseOpenEditor,
  onOpenRecentDocument,
  renderWorkspaceTreeNodes,
  displayFileName,
  displayWorkspacePath,
  outlineItems,
  outlineFontSize,
  outlineRowSpacing,
  onSelectOutlineItem,
  searchQuery,
  searchOptions,
  searchResults,
  searchBusy,
  searchError,
  searchHasRun,
  searchAutoFocusToken,
  onSearchQueryChange,
  onSearchOptionsChange,
  onRunSearch,
  onSelectSearchMatch,
}: SideBarProps) {
  const showOutline = panel === 'outline';
  const showSearch = panel === 'search';
  const showExplorer = !showOutline && !showSearch;

  return (
    <aside
      aria-label={showOutline ? 'Outline' : showSearch ? 'Search' : 'Explorer'}
      data-explorer-root={showExplorer ? '' : undefined}
      data-outline-root={showOutline ? '' : undefined}
      data-search-root={showSearch ? '' : undefined}
      tabIndex={showOutline ? -1 : undefined}
      className={cn(
        'flex min-h-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-opacity duration-300 ease-in-out',
        'explorer-sidebar',
        !isOpen && 'opacity-0 invisible overflow-hidden p-0 border-r-0',
      )}
    >
      {showOutline ? (
        <OutlinePanel
          items={outlineItems}
          busy={busy}
          fontSize={outlineFontSize}
          rowSpacing={outlineRowSpacing}
          onSelectItem={onSelectOutlineItem}
        />
      ) : showSearch ? (
        <SearchPanel
          query={searchQuery}
          options={searchOptions}
          results={searchResults}
          busy={searchBusy}
          error={searchError}
          hasRun={searchHasRun}
          autoFocusToken={searchAutoFocusToken}
          rootDir={rootDir}
          onQueryChange={onSearchQueryChange}
          onOptionsChange={onSearchOptionsChange}
          onRunSearch={onRunSearch}
          onSelectMatch={onSelectSearchMatch}
          displayFileName={displayFileName}
          displayWorkspacePath={displayWorkspacePath}
        />
      ) : (
        <ExplorerPanel
          busy={busy}
          workspaceName={workspaceName}
          workspaceFilter={workspaceFilter}
          onWorkspaceFilterChange={onWorkspaceFilterChange}
          workspaceTreeLength={workspaceTreeLength}
          filteredWorkspaceTreeLength={filteredWorkspaceTreeLength}
          openEditors={openEditors}
          recentDocuments={recentDocuments}
          activeDocumentPath={activeDocumentPath}
          rootDir={rootDir}
          onNewDocument={onNewDocument}
          onOpenDocument={onOpenDocument}
          onOpenWorkspace={onOpenWorkspace}
          onCollapseWorkspaceFolders={onCollapseWorkspaceFolders}
          onSelectOpenEditor={onSelectOpenEditor}
          onCloseOpenEditor={onCloseOpenEditor}
          onOpenRecentDocument={onOpenRecentDocument}
          renderWorkspaceTreeNodes={renderWorkspaceTreeNodes}
          displayFileName={displayFileName}
          displayWorkspacePath={displayWorkspacePath}
        />
      )}
    </aside>
  );
}
