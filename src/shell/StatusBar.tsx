interface StatusBarProps {
  mode: string;
  theme: string;
  isDirty: boolean;
}

export function StatusBar({ mode, theme, isDirty }: StatusBarProps) {
  return (
    <footer className="flex items-center justify-between px-3 py-1 border-t border-border bg-muted/50 text-xs text-muted-foreground h-6">
      <div className="flex items-center gap-4">
        <span>{isDirty ? 'Unsaved Changes' : 'Saved'}</span>
      </div>
      <div className="flex items-center gap-4">
        <span>{mode}</span>
        <span className="uppercase">{theme}</span>
      </div>
    </footer>
  );
}
