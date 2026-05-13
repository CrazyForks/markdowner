import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { CaseSensitive, Regex, WholeWord } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FindReplaceOptions } from '@/lib/findReplace';
import { ReactNode, useEffect, useRef } from 'react';

export type SideBarPanel = 'files' | 'search' | 'outline';

export interface OutlineItem {
  id: string;
  title: string;
  depth: number;
  titleStart: number;
  titleEnd: number;
  selectionStart: number;
  selectionEnd: number;
}

export interface SearchResultMatch {
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
  absoluteOffset: number;
}

export interface SearchResultFile {
  path: string;
  matches: SearchResultMatch[];
}

export interface SideBarProps {
  panel: SideBarPanel;
  isOpen: boolean;
  busy: boolean;
  workspaceFilter: string;
  onWorkspaceFilterChange: (value: string) => void;
  workspaceTreeLength: number;
  filteredWorkspaceTreeLength: number;
  recentDocuments: string[];
  activeDocumentPath: string | null;
  rootDir: string | null;
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
  workspaceFilter,
  onWorkspaceFilterChange,
  workspaceTreeLength,
  filteredWorkspaceTreeLength,
  recentDocuments,
  activeDocumentPath,
  rootDir,
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
  const outlinePaddingY = Math.max(2, outlineRowSpacing + 2);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen || !showSearch) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isOpen, showSearch, searchAutoFocusToken]);

  const totalMatches = searchResults.reduce((sum, file) => sum + file.matches.length, 0);

  return (
    <aside
      className={cn(
        'flex min-h-0 flex-col gap-5 overflow-y-auto border-r border-border bg-sidebar p-5 text-sidebar-foreground transition-opacity duration-300 ease-in-out',
        !isOpen && 'opacity-0 invisible overflow-hidden p-0 border-r-0',
      )}
    >
      {showOutline ? (
        <section className="flex min-h-0 flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Outline
          </div>
          {outlineItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No headings
            </p>
          ) : (
            <ScrollArea className="max-h-[520px] pr-2">
              <div
                data-testid="outline-list"
                className="flex flex-col"
                style={{ gap: `${outlineRowSpacing}px` }}
              >
                {outlineItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center rounded-md border border-transparent px-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      fontSize: `${outlineFontSize}px`,
                      lineHeight: 1.25,
                      paddingTop: `${outlinePaddingY}px`,
                      paddingBottom: `${outlinePaddingY}px`,
                      paddingLeft: `${8 + Math.max(0, item.depth - 1) * 12}px`,
                    }}
                    disabled={busy}
                    onClick={() => onSelectOutlineItem?.(item)}
                  >
                    <span className="truncate font-medium">{item.title}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </section>
      ) : showSearch ? (
        <section
          data-testid="sidebar-search-panel"
          className="flex min-h-0 flex-col gap-2"
        >
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Search
          </div>
          <Input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onRunSearch();
              }
            }}
            placeholder="Search across workspace"
            aria-label="Search across workspace"
            data-testid="sidebar-search-input"
          />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={searchOptions.caseSensitive ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Match case"
              aria-pressed={searchOptions.caseSensitive}
              title="Match case"
              onClick={() =>
                onSearchOptionsChange({
                  ...searchOptions,
                  caseSensitive: !searchOptions.caseSensitive,
                })
              }
            >
              <CaseSensitive className="size-4" />
            </Button>
            <Button
              type="button"
              variant={searchOptions.wholeWord ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Whole word"
              aria-pressed={searchOptions.wholeWord}
              title="Whole word"
              onClick={() =>
                onSearchOptionsChange({
                  ...searchOptions,
                  wholeWord: !searchOptions.wholeWord,
                })
              }
            >
              <WholeWord className="size-4" />
            </Button>
            <Button
              type="button"
              variant={searchOptions.regex ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Use regular expression"
              aria-pressed={searchOptions.regex}
              title="Use regular expression"
              onClick={() =>
                onSearchOptionsChange({
                  ...searchOptions,
                  regex: !searchOptions.regex,
                })
              }
            >
              <Regex className="size-4" />
            </Button>
          </div>
          {searchError ? (
            <p
              role="alert"
              data-testid="sidebar-search-error"
              className="text-xs text-destructive"
            >
              {searchError}
            </p>
          ) : null}
          {searchBusy ? (
            <p className="text-xs text-muted-foreground">Searching…</p>
          ) : searchHasRun ? (
            totalMatches === 0 ? (
              <p
                data-testid="sidebar-search-empty"
                className="text-xs text-muted-foreground"
              >
                No results
              </p>
            ) : (
              <p
                data-testid="sidebar-search-summary"
                className="text-xs text-muted-foreground"
              >
                {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {searchResults.length}{' '}
                {searchResults.length === 1 ? 'file' : 'files'}
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Press Enter to search</p>
          )}
          {searchResults.length > 0 ? (
            <ScrollArea className="max-h-[520px] pr-1">
              <div className="flex flex-col gap-3">
                {searchResults.map((file) => (
                  <div key={file.path} className="flex flex-col gap-1">
                    <button
                      type="button"
                      className="flex flex-col items-start gap-0 truncate rounded-md px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
                      title={file.path}
                      onClick={() => onSelectSearchMatch(file, file.matches[0])}
                    >
                      <span className="truncate text-xs font-semibold">
                        {displayFileName(file.path)}
                      </span>
                      <span className="w-full truncate text-[10px] text-muted-foreground">
                        {displayWorkspacePath(file.path, rootDir)}
                      </span>
                    </button>
                    <div className="flex flex-col gap-0.5 pl-2">
                      {file.matches.map((match, idx) => (
                        <button
                          key={`${file.path}-${match.absoluteOffset}-${idx}`}
                          type="button"
                          data-testid="sidebar-search-match"
                          className="flex items-baseline gap-2 rounded px-2 py-0.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => onSelectSearchMatch(file, match)}
                          title={`Line ${match.line}`}
                        >
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {match.line}
                          </span>
                          <span className="min-w-0 truncate">
                            {renderPreviewWithHighlight(match)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}
        </section>
      ) : (
        <>
          <section className="flex min-h-0 flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Files
            </div>
            {workspaceTreeLength === 0 ? (
              <p className="text-xs text-muted-foreground">
                Open a folder to populate the file tree.
              </p>
            ) : (
              <>
                <Input
                  type="text"
                  value={workspaceFilter}
                  onChange={(event) => onWorkspaceFilterChange(event.target.value)}
                  placeholder="Search this workspace"
                  disabled={busy}
                  aria-label="Filter files"
                />
                {filteredWorkspaceTreeLength === 0 ? (
                  <p className="text-xs text-muted-foreground">No files match this filter.</p>
                ) : (
                  <ScrollArea className="max-h-[360px] pr-2">
                    <div className="flex flex-col gap-1">
                      {renderWorkspaceTreeNodes()}
                    </div>
                  </ScrollArea>
                )}
              </>
            )}
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent
            </div>
            {recentDocuments.length === 0 ? (
              <p className="text-xs text-muted-foreground">Recent documents will appear here.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {recentDocuments.slice(0, 5).map((path) => {
                  const isActive = path === activeDocumentPath;
                  return (
                    <button
                      key={path}
                      type="button"
                      className={cn(
                        'flex w-full flex-col items-start gap-1 rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50',
                        isActive && 'border-border bg-accent text-accent-foreground',
                      )}
                      onClick={() => onOpenRecentDocument(path)}
                      disabled={busy}
                      title={path}
                    >
                      <span className="w-full font-medium leading-snug break-all">
                        {displayFileName(path)}
                      </span>
                      <span className="w-full text-xs leading-snug text-muted-foreground break-all">
                        {displayWorkspacePath(path, rootDir)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

function renderPreviewWithHighlight(match: SearchResultMatch) {
  const { preview, matchStart, matchEnd } = match;
  const safeStart = Math.max(0, Math.min(matchStart, preview.length));
  const safeEnd = Math.max(safeStart, Math.min(matchEnd, preview.length));
  const before = preview.slice(0, safeStart);
  const hit = preview.slice(safeStart, safeEnd);
  const after = preview.slice(safeEnd);
  return (
    <>
      <span className="text-muted-foreground">{before}</span>
      <mark className="rounded bg-yellow-500/20 px-0.5 text-foreground">{hit}</mark>
      <span className="text-muted-foreground">{after}</span>
    </>
  );
}
