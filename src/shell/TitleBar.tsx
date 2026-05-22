import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

interface TitleBarProps {
  menu: ReactNode;
  onStartWindowDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function TitleBar({ menu, onStartWindowDrag }: TitleBarProps) {
  return (
    <div
      data-testid="app-titlebar"
      className="flex h-[35px] shrink-0 items-center border-b border-border/60 bg-background"
    >
      <div
        data-tauri-drag-region
        className="h-full w-20 shrink-0"
        onPointerDown={onStartWindowDrag}
      />
      <div
        data-tauri-drag-region
        data-testid="app-titlebar-drag-region"
        className="h-full min-w-0 flex-1"
        onPointerDown={onStartWindowDrag}
      />
      {menu}
    </div>
  );
}
