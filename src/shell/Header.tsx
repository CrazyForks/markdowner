import { ReactNode } from 'react';

interface HeaderProps {
  children?: ReactNode;
}

export function Header({ children }: HeaderProps) {
  return (
    <header data-tauri-drag-region className="flex items-center justify-between px-4 py-2 border-b border-border bg-background select-none h-12">
      <div className="flex items-center gap-2">
        {/* Custom Window Controls spacer for macOS */}
        <div className="w-16 h-full" />
        <h1 className="text-sm font-semibold">Markdowner</h1>
      </div>
      <div className="flex items-center gap-2">
        {children}
      </div>
    </header>
  );
}
