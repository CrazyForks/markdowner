interface StatusBarProps {
  mode: string;
  theme: string;
  isDirty?: boolean | null;
  workspaceName?: string | null;
  activeDocumentLabel?: string | null;
  cursorLine?: number | null;
  cursorColumn?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
  readingTimeMinutes?: number | null;
}

export function StatusBar({
  mode,
  theme,
  isDirty,
  workspaceName,
  activeDocumentLabel,
  cursorLine,
  cursorColumn,
  wordCount,
  characterCount,
  readingTimeMinutes,
}: StatusBarProps) {
  const showCursorPosition =
    typeof cursorLine === 'number' && typeof cursorColumn === 'number';
  const showDocumentStats =
    typeof wordCount === 'number' && typeof characterCount === 'number';
  const showReadingTime = typeof readingTimeMinutes === 'number' && readingTimeMinutes > 0;
  const showDirtyStatus = typeof isDirty === 'boolean';

  return (
    <footer className="flex items-center justify-between px-3 py-1 border-t border-border bg-muted/50 text-xs text-muted-foreground h-6">
      <div className="flex items-center gap-4 min-w-0">
        {showDirtyStatus ? (
          <span title="Save status">{isDirty ? 'Unsaved Changes' : 'Saved'}</span>
        ) : null}
        {activeDocumentLabel ? (
          <span className="truncate" title={activeDocumentLabel}>
            {activeDocumentLabel}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {showDocumentStats ? (
          <span title="Document statistics">
            {wordCount} {wordCount === 1 ? 'word' : 'words'} · {characterCount} {characterCount === 1 ? 'char' : 'chars'}
            {showReadingTime ? ` · ~${readingTimeMinutes} min read` : ''}
          </span>
        ) : null}
        <span title="Active editor mode">{mode}</span>
        {showCursorPosition ? (
          <span title="Cursor position">
            Ln {cursorLine}, Col {cursorColumn}
          </span>
        ) : null}
        <span title="Active theme">{theme}</span>
        {workspaceName ? (
          <span title={`Workspace: ${workspaceName}`}>{workspaceName}</span>
        ) : null}
      </div>
    </footer>
  );
}
