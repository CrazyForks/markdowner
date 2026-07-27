import {
  DragEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { FileDown, Settings as SettingsIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const TAB_DRAG_DATA_TYPE = 'application/x-markdowner-tab';
const EDGE_SCROLL_ZONE_PX = 48;
const EDGE_SCROLL_MAX_STEP_PX = 18;

export type TabsItemKind = 'document' | 'settings' | 'export';

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
  onReorderTab?: (
    sourceId: string,
    targetId: string | null,
    placeAfter: boolean,
  ) => void;
}

type DropIndicator = { id: string | null; after: boolean };

function closestTabElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest('[data-tab-id]') : null;
}

function blocksTabDrag(target: EventTarget | null): boolean {
  return target instanceof Element
    ? target.closest('button, [data-no-tab-drag]') !== null
    : false;
}

export function Tabs({ items, activeTabId, onSelectTab, onCloseTab, onReorderTab }: TabsProps) {
  // Id of the tab being dragged; null while no drag is in flight. The drop
  // indicator tracks which edge of the hovered tab the drag would insert at.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const draggingIdRef = useRef<string | null>(null);
  const edgeScrollSpeedRef = useRef(0);
  const edgeScrollFrameRef = useRef<number | null>(null);

  const stopEdgeScroll = useCallback(() => {
    edgeScrollSpeedRef.current = 0;
    if (edgeScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(edgeScrollFrameRef.current);
      edgeScrollFrameRef.current = null;
    }
  }, []);

  const runEdgeScroll = useCallback(() => {
    const strip = tablistRef.current;
    const speed = edgeScrollSpeedRef.current;
    if (!strip || speed === 0) {
      edgeScrollFrameRef.current = null;
      return;
    }

    const before = strip.scrollLeft;
    strip.scrollLeft += speed;
    if (strip.scrollLeft === before) {
      stopEdgeScroll();
      return;
    }
    edgeScrollFrameRef.current = window.requestAnimationFrame(runEdgeScroll);
  }, [stopEdgeScroll]);

  const updateEdgeScroll = useCallback(
    (clientX: number) => {
      const strip = tablistRef.current;
      if (!strip || strip.scrollWidth <= strip.clientWidth) {
        stopEdgeScroll();
        return;
      }

      const rect = strip.getBoundingClientRect();
      const leftDepth = EDGE_SCROLL_ZONE_PX - (clientX - rect.left);
      const rightDepth = EDGE_SCROLL_ZONE_PX - (rect.right - clientX);
      let speed = 0;
      if (leftDepth > 0 && strip.scrollLeft > 0) {
        speed = -Math.max(
          1,
          Math.ceil(
            Math.min(1, leftDepth / EDGE_SCROLL_ZONE_PX) *
              EDGE_SCROLL_MAX_STEP_PX,
          ),
        );
      } else if (
        rightDepth > 0 &&
        strip.scrollLeft + strip.clientWidth < strip.scrollWidth
      ) {
        speed = Math.max(
          1,
          Math.ceil(
            Math.min(1, rightDepth / EDGE_SCROLL_ZONE_PX) *
              EDGE_SCROLL_MAX_STEP_PX,
          ),
        );
      }

      edgeScrollSpeedRef.current = speed;
      if (speed === 0) {
        stopEdgeScroll();
      } else if (edgeScrollFrameRef.current === null) {
        edgeScrollFrameRef.current = window.requestAnimationFrame(runEdgeScroll);
      }
    },
    [runEdgeScroll, stopEdgeScroll],
  );

  const clearDragState = useCallback(() => {
    draggingIdRef.current = null;
    setDraggingId(null);
    setDropIndicator(null);
    stopEdgeScroll();
  }, [stopEdgeScroll]);

  useEffect(() => {
    window.addEventListener('blur', clearDragState);
    return () => {
      window.removeEventListener('blur', clearDragState);
      stopEdgeScroll();
    };
  }, [clearDragState, stopEdgeScroll]);

  if (items.length === 0) return null;

  const isAfterDrop = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX > rect.left + rect.width / 2;
  };

  return (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label="Open documents"
      onDragOver={(event) => {
        const sourceId = draggingIdRef.current;
        if (!onReorderTab || !sourceId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        updateEdgeScroll(event.clientX);
        if (!closestTabElement(event.target)) {
          setDropIndicator({ id: null, after: true });
        }
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDropIndicator(null);
        stopEdgeScroll();
      }}
      onDrop={(event) => {
        const sourceId = draggingIdRef.current;
        if (!onReorderTab || !sourceId || closestTabElement(event.target)) return;
        event.preventDefault();
        onReorderTab(sourceId, null, true);
        clearDragState();
      }}
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-background"
    >
      {items.map((item) => {
        const isActive = item.id === activeTabId;
        const baseTooltip = item.shortcutLabel
          ? `${item.name} (${item.shortcutLabel})`
          : item.name;
        const tooltip = onReorderTab
          ? `${baseTooltip} — Drag to reorder`
          : baseTooltip;
        const indicator = dropIndicator?.id === item.id ? dropIndicator : null;
        return (
          <div
            key={item.id}
            data-tab-id={item.id}
            data-drop-position={
              indicator ? (indicator.after ? 'after' : 'before') : undefined
            }
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={tooltip}
            draggable={onReorderTab !== undefined}
            onDragStart={(event) => {
              if (!onReorderTab) return;
              if (blocksTabDrag(event.target)) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = 'move';
              // WebKit needs data set for native dragging to start. A private
              // type prevents an internal id from being dropped into editors.
              event.dataTransfer.setData(TAB_DRAG_DATA_TYPE, item.id);
              draggingIdRef.current = item.id;
              setDraggingId(item.id);
            }}
            onDragOver={(event) => {
              const sourceId = draggingIdRef.current;
              if (!onReorderTab || !sourceId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              updateEdgeScroll(event.clientX);
              if (sourceId === item.id) {
                setDropIndicator(null);
                return;
              }
              const after = isAfterDrop(event);
              setDropIndicator((prev) =>
                prev?.id === item.id && prev.after === after ? prev : { id: item.id, after },
              );
            }}
            onDrop={(event) => {
              const sourceId = draggingIdRef.current;
              if (!onReorderTab || !sourceId || sourceId === item.id) return;
              event.preventDefault();
              event.stopPropagation();
              onReorderTab(sourceId, item.id, isAfterDrop(event));
              clearDragState();
            }}
            onDragEnd={clearDragState}
            onClick={() => onSelectTab(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectTab(item.id);
              }
            }}
            className={cn(
              'group relative flex max-w-[220px] shrink-0 cursor-grab select-none items-center gap-1.5 border-r border-border px-3 text-sm transition-colors hover:bg-accent/40 active:cursor-grabbing',
              isActive && 'bg-accent text-accent-foreground',
              draggingId === item.id && 'opacity-50',
              indicator &&
                (indicator.after
                  ? 'shadow-[inset_-2px_0_0_var(--ring)]'
                  : 'shadow-[inset_2px_0_0_var(--ring)]'),
            )}
          >
            {item.kind === 'settings' ? (
              <SettingsIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
            {item.kind === 'export' ? (
              <FileDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
              draggable={false}
              data-no-tab-drag
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
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
      <div
        aria-hidden="true"
        data-tab-drop-end
        data-drop-position={dropIndicator?.id === null ? 'end' : undefined}
        className={cn(
          'h-full min-w-0 flex-1',
          dropIndicator?.id === null && 'border-l-2 border-ring',
        )}
      />
    </div>
  );
}
