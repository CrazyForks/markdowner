import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { Sparkles } from 'lucide-react';

import {
  buildSkillSuggestions,
  findSkillSuggestionQuery,
  type SkillSuggestion,
} from '@/lib/skillSuggestions';
import { cn } from '@/lib/utils';

type MenuState =
  | { open: false }
  | {
      open: true;
      prefix: '/' | '$';
      query: string;
      from: number;
      to: number;
      cursorTop: number;
      cursorBottom: number;
      left: number;
    };

type Placement = 'below' | 'above';

const MENU_GUTTER = 6;
const VIEWPORT_MARGIN = 8;
const EMPTY_SKILL_NAMES = new Set<string>();

interface Props {
  editor: Editor | null;
  enabled?: boolean;
  skillNames?: ReadonlySet<string>;
}

function selectionIsCode(editor: Editor): boolean {
  const $from = editor.state.selection.$from;
  if ($from.parent.type.spec.code === true) return true;
  return $from.marks().some((mark) => mark.type.name === 'code');
}

/**
 * Skill-only completion for mid-line `/` tokens and every `$` token.
 * A line-start slash belongs to SlashCommandMenu, which combines block and
 * installed-skill results in one grouped surface.
 */
export function SkillTokenMenu({
  editor,
  enabled = true,
  skillNames = EMPTY_SKILL_NAMES,
}: Props) {
  const [menu, setMenu] = useState<MenuState>({ open: false });
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement>('below');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const suggestions = useMemo<SkillSuggestion[]>(
    () =>
      menu.open
        ? buildSkillSuggestions(menu.prefix, menu.query, skillNames)
        : [],
    [menu, skillNames],
  );

  const menuQuery = menu.open ? `${menu.prefix}${menu.query}` : '';
  useEffect(() => {
    setActiveIndex(0);
  }, [menuQuery]);

  useEffect(() => {
    if (!menu.open) return;
    if (activeIndex >= suggestions.length) setActiveIndex(0);
  }, [activeIndex, menu.open, suggestions.length]);

  useEffect(() => {
    if (!menu.open || suggestions.length === 0) return;
    const item = itemRefs.current[Math.min(activeIndex, suggestions.length - 1)];
    if (typeof item?.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, menu.open, suggestions.length]);

  useLayoutEffect(() => {
    if (!menu.open) {
      setPlacement('below');
      return;
    }
    const height = menuRef.current?.offsetHeight ?? 0;
    if (height <= 0) return;
    const viewportHeight =
      typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const spaceBelow =
      viewportHeight - menu.cursorBottom - MENU_GUTTER - VIEWPORT_MARGIN;
    const spaceAbove = menu.cursorTop - MENU_GUTTER - VIEWPORT_MARGIN;
    setPlacement(
      height <= spaceBelow || spaceBelow >= spaceAbove ? 'below' : 'above',
    );
  }, [menu, suggestions.length]);

  useEffect(() => {
    if (!editor || !enabled || skillNames.size === 0) {
      setMenu({ open: false });
      return;
    }
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') return;

    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (!empty || from !== to || selectionIsCode(editor)) {
        setMenu({ open: false });
        return;
      }

      const $from = editor.state.selection.$from;
      const blockStart = $from.start($from.depth);
      const textBefore = editor.state.doc.textBetween(blockStart, from, '\n', ' ');
      const match = findSkillSuggestionQuery(textBefore);
      if (!match) {
        setMenu({ open: false });
        return;
      }

      if (match.prefix === '/' && textBefore.slice(0, match.from).trim() === '') {
        setMenu({ open: false });
        return;
      }

      const matchStart = blockStart + match.from;
      let coords: { top: number; bottom: number; left: number; right: number };
      try {
        coords = editor.view.coordsAtPos(matchStart);
      } catch {
        setMenu({ open: false });
        return;
      }

      setMenu({
        open: true,
        prefix: match.prefix,
        query: match.query,
        from: matchStart,
        to: from,
        cursorTop: coords.top,
        cursorBottom: coords.bottom,
        left: coords.left,
      });
    };

    const reposition = () => {
      setMenu((current) => {
        if (!current.open) return current;
        try {
          const coords = editor.view.coordsAtPos(current.from);
          return {
            ...current,
            cursorTop: coords.top,
            cursorBottom: coords.bottom,
            left: coords.left,
          };
        } catch {
          return current;
        }
      });
    };

    const close = () => setMenu({ open: false });
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    editor.on('blur', close);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
      editor.off('blur', close);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [editor, enabled, skillNames]);

  const runSuggestion = (suggestion: SkillSuggestion | undefined) => {
    if (!editor || !menu.open || !suggestion) return;
    const { from, to } = menu;
    setMenu({ open: false });
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContent(suggestion.token)
      .run();
  };

  useEffect(() => {
    if (!editor || !enabled || !menu.open) return;
    const dom = editor.view.dom as HTMLElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process') return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) =>
          suggestions.length === 0 ? 0 : (index + 1) % suggestions.length,
        );
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) =>
          suggestions.length === 0
            ? 0
            : (index - 1 + suggestions.length) % suggestions.length,
        );
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        if (suggestions.length === 0) return;
        event.preventDefault();
        runSuggestion(
          suggestions[Math.min(activeIndex, suggestions.length - 1)],
        );
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setMenu({ open: false });
        editor.commands.focus();
      }
    };
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [activeIndex, editor, enabled, menu, suggestions]);

  useEffect(() => {
    if (!menu.open) return;
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu({ open: false });
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [menu.open]);

  if (!menu.open || suggestions.length === 0) return null;
  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
  const positionStyle: CSSProperties =
    placement === 'above'
      ? { bottom: viewportHeight - menu.cursorTop + MENU_GUTTER, left: menu.left }
      : { top: menu.cursorBottom + MENU_GUTTER, left: menu.left };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Insert skill token"
      data-testid="skill-token-menu"
      data-placement={placement}
      className="slash-command-menu"
      style={positionStyle}
      onMouseDown={(event) => event.preventDefault()}
    >
      <ul className="slash-command-list" role="presentation">
        <li className="slash-command-group-label" role="presentation">
          Skills
        </li>
        {suggestions.map((suggestion, index) => {
          const isActive = index === Math.min(activeIndex, suggestions.length - 1);
          return (
            <li
              key={suggestion.name}
              role="presentation"
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
            >
              <button
                type="button"
                role="menuitem"
                className={cn('slash-command-item', isActive && 'is-active')}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runSuggestion(suggestion)}
                data-active={isActive ? 'true' : undefined}
              >
                <span className="slash-command-icon" aria-hidden="true">
                  <Sparkles className="size-4" />
                </span>
                <span className="slash-command-text">
                  <span className="slash-command-title">{suggestion.token}</span>
                  <span className="slash-command-description">
                    Installed skill
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>,
    portalTarget,
  );
}

export default SkillTokenMenu;
