import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { getMarkRange } from '@tiptap/core';
import { Check, Copy, ExternalLink, Unlink } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
  editor: Editor | null;
  /** When false, listeners are detached and nothing is rendered. */
  enabled?: boolean;
}

type Placement = 'above' | 'below';

type PopupState =
  | { open: false }
  | {
      open: true;
      from: number;
      to: number;
      href: string;
      anchorTop: number;
      anchorBottom: number;
      anchorLeft: number;
      anchorRight: number;
      /** 'caret' means the editor caret sits inside the link; 'hover' means the user pointed at it. */
      origin: 'caret' | 'hover';
    };

const POPUP_GUTTER_PX = 8;
const VIEWPORT_MARGIN_PX = 8;
/** Order in which Up/Down arrow keys traverse focusable popup items. */
const FOCUS_ORDER = ['url-input', 'open', 'copy', 'remove'] as const;
type FocusKey = (typeof FOCUS_ORDER)[number];

/**
 * Floating popup for editing the link at the caret or under the mouse.
 *
 * Mirrors the Notion-style chrome used elsewhere (slash menu, selection
 * toolbar). The popup appears above the link by default and flips below when
 * there is not enough room above. Up/Down arrows cycle between the URL input
 * and the action buttons inside the popup; Tab from the editor enters the
 * popup; Escape returns focus to the editor.
 */
export function LinkPopup({ editor, enabled = true }: Props) {
  const [state, setState] = useState<PopupState>({ open: false });
  const [placement, setPlacement] = useState<Placement>('above');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonsRef = useRef<Record<Exclude<FocusKey, 'url-input'>, HTMLButtonElement | null>>({
    open: null,
    copy: null,
    remove: null,
  });
  // Track which link element the mouse is currently over so we can keep the
  // popup open while the cursor travels between the link and the popup itself.
  const hoveredLinkRef = useRef<HTMLElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  // Recompute the active link range from the current caret position. Returns
  // null when the caret is not inside a link mark.
  const computeCaretLink = useCallback((): PopupState | null => {
    if (!editor) return null;
    const { state: edState, view } = editor;
    if (!view.hasFocus()) return null;
    const linkType = edState.schema.marks.link;
    if (!linkType) return null;
    const { $from } = edState.selection;
    const range = getMarkRange($from, linkType);
    if (!range) return null;
    const { from, to } = range;
    const mark = $from.marks().find((m) => m.type === linkType)
      ?? edState.doc.nodeAt(from)?.marks.find((m) => m.type === linkType);
    const href = (mark?.attrs.href as string | undefined) ?? '';
    let startCoords: { top: number; bottom: number; left: number };
    let endCoords: { top: number; bottom: number; right: number };
    try {
      startCoords = view.coordsAtPos(from);
      endCoords = view.coordsAtPos(to, -1);
    } catch {
      return null;
    }
    return {
      open: true,
      from,
      to,
      href,
      anchorTop: Math.min(startCoords.top, endCoords.top),
      anchorBottom: Math.max(startCoords.bottom, endCoords.bottom),
      anchorLeft: startCoords.left,
      anchorRight: endCoords.right,
      origin: 'caret',
    };
  }, [editor]);

  // Refresh the popup state on selection / transaction / focus changes.
  useEffect(() => {
    if (!editor || !enabled) {
      setState({ open: false });
      return;
    }
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') {
      return;
    }

    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        // Hover-mode wins until the mouse leaves the link.
        if (hoveredLinkRef.current) return;
        const next = computeCaretLink();
        if (!next) {
          setState((prev) => (prev.open && prev.origin === 'caret' ? { open: false } : prev));
          return;
        }
        setState(next);
      });
    };

    editor.on('selectionUpdate', schedule);
    editor.on('transaction', schedule);
    editor.on('focus', schedule);
    editor.on('blur', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      editor.off('selectionUpdate', schedule);
      editor.off('transaction', schedule);
      editor.off('focus', schedule);
      editor.off('blur', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [editor, enabled, computeCaretLink]);

  // Mouse hover detection on link anchors inside the editor DOM.
  useEffect(() => {
    if (!editor || !enabled) return;
    const dom = editor.view?.dom;
    if (!(dom instanceof HTMLElement)) return;

    const showForLink = (anchor: HTMLAnchorElement) => {
      const view = editor.view;
      let pos: number | null = null;
      try {
        const result = view.posAtDOM(anchor, 0);
        pos = typeof result === 'number' ? result : null;
      } catch {
        pos = null;
      }
      if (pos === null) return;
      const linkType = editor.state.schema.marks.link;
      if (!linkType) return;
      const $pos = editor.state.doc.resolve(Math.min(Math.max(pos, 0), editor.state.doc.content.size));
      const range = getMarkRange($pos, linkType);
      if (!range) return;
      const rect = anchor.getBoundingClientRect();
      setState({
        open: true,
        from: range.from,
        to: range.to,
        href: anchor.getAttribute('href') ?? '',
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        anchorLeft: rect.left,
        anchorRight: rect.right,
        origin: 'hover',
      });
    };

    const onMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
      if (!anchor || !dom.contains(anchor)) return;
      clearHideTimer();
      hoveredLinkRef.current = anchor;
      showForLink(anchor);
    };

    const onMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
      if (!anchor || anchor !== hoveredLinkRef.current) return;
      const next = event.relatedTarget as Node | null;
      // Mouse moved into the popup → keep showing.
      if (next && containerRef.current?.contains(next)) return;
      // Mouse moved to a child of the same link.
      if (next && anchor.contains(next)) return;
      hoveredLinkRef.current = null;
      // Delay closing so the cursor can travel across the gap to the popup.
      clearHideTimer();
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        if (hoveredLinkRef.current) return;
        setState((prev) => {
          if (!prev.open || prev.origin !== 'hover') return prev;
          // If the caret is now inside a link, hand off to caret-mode.
          const caret = computeCaretLink();
          return caret ?? { open: false };
        });
      }, 120);
    };

    dom.addEventListener('mouseover', onMouseOver);
    dom.addEventListener('mouseout', onMouseOut);
    return () => {
      dom.removeEventListener('mouseover', onMouseOver);
      dom.removeEventListener('mouseout', onMouseOut);
      clearHideTimer();
    };
  }, [editor, enabled, computeCaretLink]);

  // Sync the input draft with the active href whenever the state changes to a
  // different link. This avoids stomping mid-edit text when the popup remains
  // open across selection updates.
  useEffect(() => {
    if (!state.open) {
      setDraft('');
      setCopied(false);
      return;
    }
    setDraft(state.href);
    setCopied(false);
  }, [state.open ? `${state.from}:${state.to}:${state.href}` : null]);

  // Decide whether the popup floats above or below the link.
  useLayoutEffect(() => {
    if (!state.open) return;
    const node = containerRef.current;
    if (!node) return;
    const height = node.offsetHeight;
    if (height <= 0) return;
    const viewportHeight =
      typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const spaceAbove = state.anchorTop - POPUP_GUTTER_PX - VIEWPORT_MARGIN_PX;
    const spaceBelow = viewportHeight - state.anchorBottom - POPUP_GUTTER_PX - VIEWPORT_MARGIN_PX;
    let next: Placement;
    if (height <= spaceAbove) {
      next = 'above';
    } else if (height <= spaceBelow) {
      next = 'below';
    } else {
      next = spaceAbove >= spaceBelow ? 'above' : 'below';
    }
    setPlacement((prev) => (prev === next ? prev : next));
  }, [state]);

  // Listen for Tab on the editor DOM so the user can enter the popup with the
  // keyboard. Without this Tab would insert a tab character / move the caret.
  useEffect(() => {
    if (!editor || !enabled || !state.open) return;
    const dom = editor.view?.dom as HTMLElement | undefined;
    if (!dom) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.isComposing) return;
      // Only intercept Tab when the caret is actually inside the link — hover
      // mode shouldn't steal Tab from regular editor navigation.
      if (state.origin !== 'caret') return;
      event.preventDefault();
      focusItem('url-input');
    };
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, enabled, state]);

  const focusItem = useCallback((key: FocusKey) => {
    if (key === 'url-input') {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    buttonsRef.current[key]?.focus();
  }, []);

  const moveFocus = (current: FocusKey, direction: 1 | -1) => {
    const idx = FOCUS_ORDER.indexOf(current);
    if (idx === -1) return;
    const next = FOCUS_ORDER[(idx + direction + FOCUS_ORDER.length) % FOCUS_ORDER.length];
    focusItem(next);
  };

  const commitHref = useCallback(
    (rawHref: string) => {
      if (!editor || !state.open) return;
      const trimmed = rawHref.trim();
      if (trimmed === '') {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: state.from, to: state.to })
          .unsetLink()
          .setTextSelection(state.to)
          .run();
        setState({ open: false });
        return;
      }
      editor
        .chain()
        .setTextSelection({ from: state.from, to: state.to })
        .extendMarkRange('link')
        .setLink({ href: trimmed })
        .setTextSelection(state.to)
        .focus()
        .run();
    },
    [editor, state],
  );

  const handleRemove = () => {
    if (!editor || !state.open) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: state.from, to: state.to })
      .unsetLink()
      .setTextSelection(state.to)
      .run();
    setState({ open: false });
  };

  const handleCopy = async () => {
    if (!state.open) return;
    try {
      await navigator.clipboard.writeText(draft.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API unavailable — silently fail; manual copy still works.
    }
  };

  const handleOpen = () => {
    if (!state.open) return;
    const target = draft.trim();
    if (!target) return;
    try {
      window.open(target, '_blank', 'noopener,noreferrer');
    } catch {
      // No-op: the Tauri webview may block this without a shell plugin. The
      // copy button is still available as a fallback.
    }
  };

  const handleKeyDownInItem = (key: FocusKey) => (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(key, 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(key, -1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (editor) editor.commands.focus();
      setState((prev) => (prev.open && prev.origin === 'hover' ? { open: false } : prev));
      return;
    }
    if (event.key === 'Enter') {
      if (key === 'url-input') {
        event.preventDefault();
        commitHref(draft);
        if (editor) editor.commands.focus();
      }
    }
  };

  // Hide popup when clicking outside both popup and editor.
  useEffect(() => {
    if (!state.open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      const dom = editor?.view?.dom;
      if (dom instanceof HTMLElement && dom.contains(target)) return;
      setState({ open: false });
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [state.open, editor]);

  const positionStyle = useMemo<CSSProperties | null>(() => {
    if (!state.open) return null;
    const centerX = (state.anchorLeft + state.anchorRight) / 2;
    if (typeof window === 'undefined') {
      return { top: 0, left: centerX };
    }
    if (placement === 'above') {
      return {
        top: state.anchorTop - POPUP_GUTTER_PX,
        left: centerX,
        transform: 'translate(-50%, -100%)',
      };
    }
    return {
      top: state.anchorBottom + POPUP_GUTTER_PX,
      left: centerX,
      transform: 'translate(-50%, 0)',
    };
  }, [placement, state]);

  if (!enabled || !state.open || !positionStyle) return null;

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  const stopMouseDown = (event: { preventDefault: () => void; target: EventTarget | null }) => {
    // Don't blur the URL input when clicking the toolbar shell.
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
  };

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Edit link"
      data-testid="link-popup"
      data-placement={placement}
      className="link-popup"
      style={positionStyle}
      onMouseDown={stopMouseDown}
      onMouseEnter={clearHideTimer}
      onMouseLeave={() => {
        // Re-evaluate after the gap; if the caret isn't on a link either,
        // the popup will close.
        if (state.origin !== 'hover') return;
        clearHideTimer();
        hideTimerRef.current = window.setTimeout(() => {
          hideTimerRef.current = null;
          setState((prev) => {
            if (!prev.open || prev.origin !== 'hover') return prev;
            return computeCaretLink() ?? { open: false };
          });
        }, 120);
      }}
    >
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
        autoComplete="off"
        className="link-popup-input"
        aria-label="Link URL"
        value={draft}
        placeholder="https://"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commitHref(draft)}
        onKeyDown={handleKeyDownInItem('url-input')}
      />
      <span aria-hidden className="link-popup-separator" />
      <LinkPopupButton
        label="Open link"
        innerRef={(node) => {
          buttonsRef.current.open = node;
        }}
        onClick={handleOpen}
        onKeyDown={handleKeyDownInItem('open')}
      >
        <ExternalLink className="size-4" />
      </LinkPopupButton>
      <LinkPopupButton
        label={copied ? 'Copied' : 'Copy URL'}
        innerRef={(node) => {
          buttonsRef.current.copy = node;
        }}
        onClick={handleCopy}
        onKeyDown={handleKeyDownInItem('copy')}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </LinkPopupButton>
      <LinkPopupButton
        label="Remove link"
        danger
        innerRef={(node) => {
          buttonsRef.current.remove = node;
        }}
        onClick={handleRemove}
        onKeyDown={handleKeyDownInItem('remove')}
      >
        <Unlink className="size-4" />
      </LinkPopupButton>
    </div>,
    portalTarget,
  );
}

interface LinkPopupButtonProps {
  label: string;
  danger?: boolean;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  innerRef: (node: HTMLButtonElement | null) => void;
  children: React.ReactNode;
}

function LinkPopupButton({
  label,
  danger = false,
  onClick,
  onKeyDown,
  innerRef,
  children,
}: LinkPopupButtonProps) {
  return (
    <button
      ref={innerRef}
      type="button"
      aria-label={label}
      title={label}
      className={cn('link-popup-button', danger && 'is-danger')}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
}

export default LinkPopup;
