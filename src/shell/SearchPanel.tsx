import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const totalMatches = results.reduce((sum, file) => sum + file.matches.length, 0);

  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [autoFocusToken]);

  const resultRows = () =>
    Array.from(
      resultsRef.current?.querySelectorAll<HTMLElement>('[data-search-row]') ?? [],
    );

  const focusFirstResultRow = () => {
    resultRows()[0]?.focus();
  };

  // ArrowUp/Down walk the flat row list (file headers + matches); ArrowUp on
  // the first row returns to the query input. Enter activates natively via
  // the button click; Cmd+ArrowDown is the explicit "jump to this match"
  // chord requested for parity with the input's ArrowDown entry point.
  const handleResultRowKeyDown = (activate: () => void) =>
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
        event.preventDefault();
        activate();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const rows = resultRows();
      const index = rows.indexOf(event.currentTarget as HTMLElement);
      if (index < 0) return;
      if (event.key === 'ArrowUp' && index === 0) {
        searchInputRef.current?.focus();
        return;
      }
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : index - 1;
      rows[next]?.focus();
      rows[next]?.scrollIntoView?.({ block: 'nearest' });
    };

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
              return;
            }
            // Hand keyboard focus to the result list, VS Code style.
            if (event.key === 'ArrowDown' && !event.metaKey && !event.ctrlKey && !event.altKey) {
              event.preventDefault();
              focusFirstResultRow();
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
          // Radix's scroll viewport wraps children in a `display: table` div
          // that grows to the content's intrinsic width — long match previews
          // pushed past the sidebar edge instead of truncating. Force the
          // wrapper back to a width-constrained block so `truncate` works.
          <ScrollArea className="mt-2 min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:w-full">
            <div ref={resultsRef} className="flex w-full flex-col gap-2 py-1">
              {results.map((file) => (
                <div key={file.path} className="flex min-w-0 flex-col gap-1.5">
                  <button
                    type="button"
                    data-search-row=""
                    tabIndex={-1}
                    className="explorer-tree-row flex w-full min-w-0 items-center gap-2 text-left hover:bg-accent hover:text-accent-foreground"
                    title={file.path}
                    onClick={() => onSelectMatch(file, file.matches[0])}
                    onKeyDown={handleResultRowKeyDown(() =>
                      onSelectMatch(file, file.matches[0]),
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {displayFileName(file.path)}
                      </span>
                      <span className="block w-full truncate text-[10px] text-muted-foreground">
                        {displayWorkspacePath(file.path, rootDir)}
                      </span>
                    </span>
                    <span
                      aria-label={`${file.matches.length} matches`}
                      className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums leading-none text-muted-foreground"
                    >
                      {file.matches.length}
                    </span>
                  </button>
                  <div className="flex min-w-0 flex-col pl-2">
                    {file.matches.map((match, idx) => (
                      <button
                        key={`${file.path}-${match.absoluteOffset}-${idx}`}
                        type="button"
                        data-testid="sidebar-search-match"
                        data-search-row=""
                        tabIndex={-1}
                        className="explorer-tree-row flex w-full min-w-0 items-baseline gap-2 py-0.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                        onClick={() => onSelectMatch(file, match)}
                        onKeyDown={handleResultRowKeyDown(() => onSelectMatch(file, match))}
                        title={`Line ${match.line}`}
                      >
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {match.line}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
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
