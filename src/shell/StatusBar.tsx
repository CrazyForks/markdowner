interface StatusBarProps {
  mode: string;
  theme: string;
  isDirty: boolean;
  workspaceName?: string | null;
  activeDocumentLabel?: string | null;
  cursorLine?: number | null;
  cursorColumn?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
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
}: StatusBarProps) {
  const showCursorPosition =
    typeof cursorLine === 'number' && typeof cursorColumn === 'number';
  const showDocumentStats =
    typeof wordCount === 'number' && typeof characterCount === 'number';

  return (
    <footer className="flex items-center justify-between px-3 py-1 border-t border-border bg-muted/50 text-xs text-muted-foreground h-6">
      <div className="flex items-center gap-4 min-w-0">
        <span>{isDirty ? 'Unsaved Changes' : 'Saved'}</span>
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
          </span>
        ) : null}
        <span>{mode}</span>
        {showCursorPosition ? (
          <span title="Cursor position">
            Ln {cursorLine}, Col {cursorColumn}
          </span>
        ) : null}
        <span className="uppercase">{theme}</span>
        {workspaceName ? (
          <span title={`Workspace: ${workspaceName}`}>{workspaceName}</span>
        ) : null}
      </div>
    </footer>
  );
}
