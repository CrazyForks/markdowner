import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface MinimapProps {
  /** Markdown source displayed in the downscaled preview. */
  text: string;
  /** The scrollable element to mirror and control. Pass null while unavailable. */
  scrollEl: HTMLElement | null;
  className?: string;
}

interface ViewportRect {
  top: number;
  height: number;
}

/**
 * VS Code-style minimap: a tiny preview column anchored to the right of the
 * editor surface. Renders the raw markdown source at ~1-2px font, draws a
 * viewport indicator over the visible region, and routes clicks back into
 * the underlying editor as a proportional scroll.
 */
export function Minimap({ text, scrollEl, className }: MinimapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<ViewportRect>({ top: 0, height: 0 });
  const draggingRef = useRef(false);

  const recalcViewport = useCallback(() => {
    const scroller = scrollEl;
    const root = rootRef.current;
    if (!scroller || !root) {
      setViewport({ top: 0, height: 0 });
      return;
    }
    const totalHeight = scroller.scrollHeight;
    const visibleHeight = scroller.clientHeight;
    const rootHeight = root.clientHeight;
    if (totalHeight <= 0 || visibleHeight <= 0 || rootHeight <= 0) {
      setViewport({ top: 0, height: rootHeight });
      return;
    }
    const heightRatio = Math.min(1, visibleHeight / totalHeight);
    const topRatio =
      totalHeight - visibleHeight > 0
        ? scroller.scrollTop / (totalHeight - visibleHeight)
        : 0;
    const indicatorHeight = Math.max(20, heightRatio * rootHeight);
    const indicatorTop = Math.max(
      0,
      Math.min(rootHeight - indicatorHeight, topRatio * (rootHeight - indicatorHeight)),
    );
    setViewport({ top: indicatorTop, height: indicatorHeight });
  }, [scrollEl]);

  useEffect(() => {
    recalcViewport();
  }, [recalcViewport, text]);

  useEffect(() => {
    const scroller = scrollEl;
    if (!scroller) return;
    const onScroll = () => recalcViewport();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => recalcViewport());
    ro.observe(scroller);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [recalcViewport, scrollEl]);

  const scrollToClientY = useCallback(
    (clientY: number) => {
      const scroller = scrollEl;
      const root = rootRef.current;
      if (!scroller || !root) return;
      const rect = root.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const totalHeight = scroller.scrollHeight;
      const visibleHeight = scroller.clientHeight;
      const target = ratio * totalHeight - visibleHeight / 2;
      const clamped = Math.max(0, Math.min(totalHeight - visibleHeight, target));
      scroller.scrollTop = clamped;
    },
    [scrollEl],
  );

  // Drag-to-scroll: mousedown starts tracking, mousemove updates the scroll
  // until mouseup releases. Bound at the document level so the user can drag
  // outside the minimap rect without losing the gesture.
  useEffect(() => {
    if (!draggingRef.current) return;
    const onMove = (event: MouseEvent) => {
      scrollToClientY(event.clientY);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  });

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      draggingRef.current = true;
      scrollToClientY(event.clientY);
    },
    [scrollToClientY],
  );

  return (
    <div
      ref={rootRef}
      data-testid="editor-minimap"
      role="presentation"
      aria-hidden="true"
      className={cn('minimap', className)}
      onMouseDown={handleMouseDown}
    >
      <pre className="minimap-content">{text}</pre>
      <div
        className="minimap-viewport"
        style={{ top: viewport.top, height: viewport.height }}
      />
    </div>
  );
}

export default Minimap;
