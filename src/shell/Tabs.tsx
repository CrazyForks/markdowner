import { MouseEvent } from 'react';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TabsItemKind = 'document' | 'settings';

export interface TabsItem {
  id: string;
  kind: TabsItemKind;
  name: string;
  isDirty: boolean;
  missing: boolean;
  shortcutLabel: string | null;
}

interface TabsProps {
  items: TabsItem[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function Tabs({ items, activeTabId, onSelectTab, onCloseTab }: TabsProps) {
  if (items.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-background"
    >
      {items.map((item) => {
        const isActive = item.id === activeTabId;
        const tooltip = item.shortcutLabel
          ? `${item.name} (${item.shortcutLabel})`
          : item.name;
        return (
          <div
            key={item.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={tooltip}
            onClick={() => onSelectTab(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectTab(item.id);
              }
            }}
            className={cn(
              'group relative flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-sm transition-colors hover:bg-accent/40',
              isActive && 'bg-accent text-accent-foreground',
            )}
          >
            {item.kind === 'settings' ? (
              <SettingsIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
            <span className={cn('truncate', item.missing && 'italic text-muted-foreground line-through')}>
              {item.name}
            </span>
            {item.missing ? (
              <span
                aria-label="File missing on disk"
                title="File no longer exists on disk"
                className="ml-1 rounded bg-destructive/15 px-1 text-[10px] uppercase tracking-wide text-destructive"
              >
                missing
              </span>
            ) : null}
            {item.isDirty ? (
              <span aria-label="Unsaved changes" className="text-base leading-none text-muted-foreground">
                ●
              </span>
            ) : null}
            <button
              type="button"
              aria-label="Close tab"
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                onCloseTab(item.id);
              }}
              className={cn(
                'ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
