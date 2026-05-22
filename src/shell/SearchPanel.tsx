import { useEffect, useRef } from 'react';
import { CaseSensitive, Regex, WholeWord } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { FindReplaceOptions } from '@/lib/findReplace';

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

export interface SearchPanelProps {
  query: string;
  options: FindReplaceOptions;
  results: SearchResultFile[];
  busy: boolean;
  error: string | null;
  hasRun: boolean;
  autoFocusToken: number;
  rootDir: string | null;
  onQueryChange: (value: string) => void;
  onOptionsChange: (options: FindReplaceOptions) => void;
  onRunSearch: () => void;
  onSelectMatch: (file: SearchResultFile, match: SearchResultMatch) => void;
  displayFileName: (path: string) => string;
  displayWorkspacePath: (path: string, rootDir: string | null) => string;
}

export function SearchPanel({
  query,
  options,
  results,
  busy,
  error,
  hasRun,
  autoFocusToken,
  rootDir,
  onQueryChange,
  onOptionsChange,
  onRunSearch,
  onSelectMatch,
  displayFileName,
  displayWorkspacePath,
}: SearchPanelProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const totalMatches = results.reduce((sum, file) => sum + file.matches.length, 0);

  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [autoFocusToken]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground">
          SEARCH
        </div>
      </div>
      <section
        data-testid="sidebar-search-panel"
        className="explorer-section flex min-h-0 flex-1 flex-col border-t border-sidebar-border/70"
      >
        <div className="explorer-section-header">Search</div>
        <Input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onRunSearch();
            }
          }}
          placeholder="Search across workspace"
          aria-label="Search across workspace"
          data-testid="sidebar-search-input"
          className="mx-3 mb-2 h-7 w-[calc(100%-1.5rem)] rounded-sm text-xs"
        />
        <div className="flex items-center gap-1 px-3">
          <Button
            type="button"
            variant={options.caseSensitive ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Match case"
            aria-pressed={options.caseSensitive}
            title="Match case"
            onClick={() =>
              onOptionsChange({
                ...options,
                caseSensitive: !options.caseSensitive,
              })
            }
          >
            <CaseSensitive className="size-4" />
          </Button>
          <Button
            type="button"
            variant={options.wholeWord ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Whole word"
            aria-pressed={options.wholeWord}
            title="Whole word"
            onClick={() =>
              onOptionsChange({
                ...options,
                wholeWord: !options.wholeWord,
              })
            }
          >
            <WholeWord className="size-4" />
          </Button>
          <Button
            type="button"
            variant={options.regex ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Use regular expression"
            aria-pressed={options.regex}
            title="Use regular expression"
            onClick={() =>
              onOptionsChange({
                ...options,
                regex: !options.regex,
              })
            }
          >
            <Regex className="size-4" />
          </Button>
        </div>
        {error ? (
          <p
            role="alert"
            data-testid="sidebar-search-error"
            className="px-3 pt-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
        {busy ? (
          <p className="px-3 pt-2 text-xs text-muted-foreground">Searching…</p>
        ) : hasRun ? (
          totalMatches === 0 ? (
            <p
              data-testid="sidebar-search-empty"
              className="px-3 pt-2 text-xs text-muted-foreground"
            >
              No results
            </p>
          ) : (
            <p
              data-testid="sidebar-search-summary"
              className="px-3 pt-2 text-xs text-muted-foreground"
            >
              {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {results.length}{' '}
              {results.length === 1 ? 'file' : 'files'}
            </p>
          )
        ) : (
          <p className="px-3 pt-2 text-xs text-muted-foreground">
            Type to search workspace and open files
          </p>
        )}
        {results.length > 0 ? (
          <ScrollArea className="mt-2 min-h-0 flex-1">
            <div className="flex flex-col gap-2 py-1">
              {results.map((file) => (
                <div key={file.path} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    className="explorer-tree-row flex min-w-0 flex-col items-start truncate text-left hover:bg-accent hover:text-accent-foreground"
                    title={file.path}
                    onClick={() => onSelectMatch(file, file.matches[0])}
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
                        className="explorer-tree-row flex items-baseline gap-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                        onClick={() => onSelectMatch(file, match)}
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
    </div>
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
