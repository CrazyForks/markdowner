import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  CheckSquare,
  Code,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table as TableIcon,
  Type,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { publishEditorEvent, subscribeEditorEvent } from '@/lib/editorEvents';

type SlashItemKind = 'block' | 'prompt-image';

type SlashItem = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: typeof Type;
  kind?: SlashItemKind;
  run?: (editor: Editor) => void;
};

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'paragraph',
    title: 'Text',
    description: 'Plain paragraph text.',
    keywords: ['text', 'paragraph', 'plain', 'p'],
    icon: Pilcrow,
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Large section heading.',
    keywords: ['h1', 'heading', 'title'],
    icon: Heading1,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading.',
    keywords: ['h2', 'heading'],
    icon: Heading2,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading.',
    keywords: ['h3', 'heading'],
    icon: Heading3,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bulleted',
    title: 'Bulleted list',
    description: 'Simple bulleted list.',
    keywords: ['bullet', 'unordered', 'list', 'ul'],
    icon: List,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    description: 'List with numbering.',
    keywords: ['numbered', 'ordered', 'list', 'ol'],
    icon: ListOrdered,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    title: 'To-do list',
    description: 'Track tasks with checkboxes.',
    keywords: ['todo', 'task', 'checkbox', 'check'],
    icon: CheckSquare,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Block quote.',
    keywords: ['quote', 'blockquote'],
    icon: Quote,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    description: 'Fenced code block.',
    keywords: ['code', 'codeblock', 'pre', 'fenced'],
    icon: Code,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal rule.',
    keywords: ['divider', 'hr', 'rule', 'separator', 'line'],
    icon: Minus,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'table',
    title: 'Table',
    description: '3×3 table with header row.',
    keywords: ['table', 'grid'],
    icon: TableIcon,
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'inline-code',
    title: 'Inline code',
    description: 'Toggle inline code mark.',
    keywords: ['inline', 'code', 'mark'],
    icon: Hash,
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    id: 'image',
    title: 'Image',
    description: 'Embed an image by URL.',
    keywords: ['image', 'img', 'picture', 'photo'],
    icon: ImageIcon,
    // The runner sub-mode lives inside the menu — window.prompt is unreliable
    // in WKWebView (Tauri) and feels jarring inside a desktop app. The image
    // URL input is rendered as a secondary panel within this same portal so
    // focus / keyboard handling stays consistent with the rest of the menu.
    kind: 'prompt-image',
  },
  {
    id: 'link',
    title: 'Link',
    description: 'Insert or convert text into a link.',
    keywords: ['link', 'url', 'hyperlink', 'anchor'],
    icon: LinkIcon,
    run: (editor) => {
      // Apply a placeholder link mark on whatever the caret currently covers,
      // then ask the floating LinkPopup to focus its URL input so the user
      // can type immediately. Mirrors the selection-toolbar Link flow.
      const { from, to } = editor.state.selection;
      if (from === to) {
        editor
          .chain()
          .focus()
          .insertContent('link')
          .setTextSelection({ from, to: from + 4 })
          .run();
      }
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: 'https://' })
        .run();
      publishEditorEvent('link:edit-request', { focusInput: true });
    },
  },
];

type MenuStage = 'list' | 'image-url';

type MenuState =
  | { open: false }
  | {
      open: true;
      stage: MenuStage;
      query: string;
      /** Document position of the slash character. */
      from: number;
      /** Document position immediately after the typed query. */
      to: number;
      /** Viewport coords for the slash caret line — used to decide above/below placement. */
      cursorTop: number;
      cursorBottom: number;
      left: number;
    };

type Placement = 'below' | 'above';

/** Pixels of breathing room between the menu and the cursor / viewport edges. */
const MENU_GUTTER = 6;
const VIEWPORT_MARGIN = 8;

interface Props {
  editor: Editor | null;
  /** When false, the menu listeners are detached entirely (e.g. non-Wysiwyg mode). */
  enabled?: boolean;
}

/**
 * Notion-style slash command launcher.
 *
 * Watches the active selection for a `/<query>` token at the start of a block
 * (or after whitespace) and offers a filtered list of block-level insertions
 * such as headings, lists, code blocks, and tables.
 */
export function SlashCommandMenu({ editor, enabled = true }: Props) {
  const [menu, setMenu] = useState<MenuState>({ open: false });
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement>('below');
  const [imageUrl, setImageUrl] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const filteredItems = useMemo(() => {
    if (!menu.open) return SLASH_ITEMS;
    const query = menu.query.trim().toLowerCase();
    if (!query) return SLASH_ITEMS;
    return SLASH_ITEMS.filter((item) => {
      if (item.title.toLowerCase().includes(query)) return true;
      return item.keywords.some((keyword) => keyword.toLowerCase().startsWith(query));
    });
  }, [menu]);

  // Keep activeIndex clamped to filteredItems length.
  useEffect(() => {
    if (!menu.open) {
      setActiveIndex(0);
      return;
    }
    if (activeIndex >= filteredItems.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, filteredItems.length, menu.open]);

  // Keep the active item visible while the user arrows through the list.
  // Without this the selection highlight slides off-screen because the menu
  // body has a capped max-height and overflows.
  useEffect(() => {
    if (!menu.open || menu.stage !== 'list') return;
    const safeIndex = Math.min(activeIndex, filteredItems.length - 1);
    const node = itemRefs.current[safeIndex];
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, filteredItems, menu]);

  // Focus the image URL input as soon as the image stage mounts.
  useLayoutEffect(() => {
    if (!menu.open || menu.stage !== 'image-url') return;
    imageInputRef.current?.focus();
    imageInputRef.current?.select();
  }, [menu]);

  // Flip the menu above the caret when there isn't enough room below — keeps
  // the dropdown from being clipped near the bottom of the viewport. Item
  // order is preserved; only the box's anchor side changes.
  useLayoutEffect(() => {
    if (!menu.open) {
      setPlacement('below');
      return;
    }
    const menuEl = menuRef.current;
    if (!menuEl) return;
    const height = menuEl.offsetHeight;
    if (height <= 0) return;
    const viewportHeight =
      typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const spaceBelow = viewportHeight - menu.cursorBottom - MENU_GUTTER - VIEWPORT_MARGIN;
    const spaceAbove = menu.cursorTop - MENU_GUTTER - VIEWPORT_MARGIN;
    let next: Placement;
    if (height <= spaceBelow) {
      next = 'below';
    } else if (height <= spaceAbove) {
      next = 'above';
    } else {
      next = spaceAbove > spaceBelow ? 'above' : 'below';
    }
    setPlacement((prev) => (prev === next ? prev : next));
  }, [menu, filteredItems]);

  // Watch editor transactions and recompute menu state. Selection / update
  // events refresh the query and caret coords; scroll / resize re-anchor the
  // popup to the slash character so it tracks the editor surface instead of
  // floating away when the user scrolls past it.
  useEffect(() => {
    if (!editor || !enabled) {
      setMenu({ open: false });
      return;
    }
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') {
      // Test mocks and partially-initialized editors don't implement the event
      // bus — skip silently rather than crashing the render.
      return;
    }

    const update = () => {
      const { state } = editor;
      const { from, to, empty } = state.selection;
      if (!empty || from !== to) {
        setMenu((prev) => (prev.open && prev.stage === 'image-url' ? prev : { open: false }));
        return;
      }

      const $from = state.selection.$from;
      const blockStart = $from.start($from.depth);
      const textBefore = state.doc.textBetween(blockStart, from, '\n', ' ');
      // Match slash commands only at the start of a block (allowing leading
      // indentation). API routes such as "DELETE /api/..." commonly contain
      // slashes after ordinary text and must remain plain document content.
      const match = textBefore.match(/^(\s*)\/([^\s/]*)$/);
      if (!match) {
        setMenu((prev) => (prev.open && prev.stage === 'image-url' ? prev : { open: false }));
        return;
      }

      const query = match[2] ?? '';
      const leadingWhitespace = match[1]?.length ?? 0;
      const matchStart = blockStart + leadingWhitespace;
      // Sanity: matchStart must point at the slash character.
      if (matchStart < blockStart || textBefore[leadingWhitespace] !== '/') {
        setMenu((prev) => (prev.open && prev.stage === 'image-url' ? prev : { open: false }));
        return;
      }

      let coords: { top: number; bottom: number; left: number; right: number };
      try {
        coords = editor.view.coordsAtPos(matchStart);
      } catch {
        setMenu((prev) => (prev.open && prev.stage === 'image-url' ? prev : { open: false }));
        return;
      }

      setMenu((prev) => {
        // Preserve the image-url stage across selection updates — those updates
        // fire as the user types in the URL input, and we don't want them to
        // bounce the menu back to the command list.
        if (prev.open && prev.stage === 'image-url') {
          return {
            ...prev,
            cursorTop: coords.top,
            cursorBottom: coords.bottom,
            left: coords.left,
          };
        }
        return {
          open: true,
          stage: 'list',
          query,
          from: matchStart,
          to: from,
          cursorTop: coords.top,
          cursorBottom: coords.bottom,
          left: coords.left,
        };
      });
    };

    // Lightweight reposition — only updates coords when the menu is already
    // open. Used by scroll / resize so we don't accidentally re-open a menu
    // the user just dismissed, and so a scroll inside an empty doc doesn't
    // flash the menu on.
    const reposition = () => {
      setMenu((prev) => {
        if (!prev.open) return prev;
        try {
          const coords = editor.view.coordsAtPos(prev.from);
          return {
            ...prev,
            cursorTop: coords.top,
            cursorBottom: coords.bottom,
            left: coords.left,
          };
        } catch {
          return prev;
        }
      });
    };

    editor.on('selectionUpdate', update);
    editor.on('update', update);
    const handleBlur = () => setMenu({ open: false });
    editor.on('blur', handleBlur);
    window.addEventListener('resize', reposition);
    // Capture-phase scroll listens to inner scroll containers (the WYSIWYG
    // editor pane has `overflow: auto`, so its scroll never bubbles to window
    // — only the capture phase sees it).
    window.addEventListener('scroll', reposition, true);

    // External "open the slash menu at the current caret" trigger (Mod+/, the
    // command palette, etc.). Behaves as if the user had typed a slash at the
    // block start — but without a slash character to delete on selection.
    // Setting from === to === current caret means `runItem`'s `deleteRange`
    // becomes a no-op, so the block insertion happens cleanly at the caret.
    const unsubscribeOpenAtCursor = subscribeEditorEvent('slash:open-at-cursor', () => {
      const { state } = editor;
      const { from, empty } = state.selection;
      if (!empty) return;
      let coords: { top: number; bottom: number; left: number; right: number };
      try {
        coords = editor.view.coordsAtPos(from);
      } catch {
        return;
      }
      setMenu({
        open: true,
        stage: 'list',
        query: '',
        from,
        to: from,
        cursorTop: coords.top,
        cursorBottom: coords.bottom,
        left: coords.left,
      });
    });

    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
      editor.off('blur', handleBlur);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      unsubscribeOpenAtCursor();
    };
  }, [editor, enabled]);

  // Keyboard navigation lives on the editor DOM so it runs ahead of Tiptap's
  // own keymap and we can swallow arrows/Enter/Escape while open. The image
  // URL sub-stage owns its own keys via its onKeyDown handler, so the editor
  // DOM listener only runs when we're still showing the command list.
  useEffect(() => {
    if (!editor || !enabled || !menu.open || menu.stage !== 'list') return;
    const dom = editor.view.dom as HTMLElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process') return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) =>
          filteredItems.length === 0 ? 0 : (current + 1) % filteredItems.length,
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) =>
          filteredItems.length === 0
            ? 0
            : (current - 1 + filteredItems.length) % filteredItems.length,
        );
        return;
      }
      if (event.key === 'Enter') {
        if (filteredItems.length === 0) {
          setMenu({ open: false });
          return;
        }
        event.preventDefault();
        runItem(filteredItems[Math.min(activeIndex, filteredItems.length - 1)]);
        return;
      }
      if (event.key === 'Tab') {
        if (filteredItems.length === 0) return;
        event.preventDefault();
        runItem(filteredItems[Math.min(activeIndex, filteredItems.length - 1)]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu({ open: false });
        return;
      }
    };

    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, enabled, menu, filteredItems, activeIndex]);

  // Close on outside click. Scrolling repositions (see the main effect) so a
  // separate close-on-scroll path would just double-close — leave it out.
  useEffect(() => {
    if (!menu.open) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenu({ open: false });
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [menu.open]);

  const beginImagePrompt = () => {
    setImageUrl('https://');
    setMenu((prev) => (prev.open ? { ...prev, stage: 'image-url' } : prev));
  };

  const commitImage = () => {
    if (!editor || !menu.open) return;
    const trimmed = imageUrl.trim();
    const { from, to } = menu;
    setMenu({ open: false });
    setImageUrl('');
    if (!trimmed || trimmed === 'https://') {
      // Drop the slash-command text so the user doesn't end up with a
      // stranded "/image" in their document when they bail on the URL.
      editor.chain().focus().deleteRange({ from, to }).run();
      return;
    }
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .setImage({ src: trimmed })
      .run();
  };

  const cancelImagePrompt = () => {
    setMenu({ open: false });
    setImageUrl('');
    editor?.commands.focus();
  };

  const runItem = (item: SlashItem | undefined) => {
    if (!item || !editor || !menu.open) return;
    if (item.kind === 'prompt-image') {
      beginImagePrompt();
      return;
    }
    const { from, to } = menu;
    setMenu({ open: false });
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .run();
    item.run?.(editor);
  };

  if (!menu.open) return null;

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  const viewportHeight =
    typeof window === 'undefined' ? 0 : window.innerHeight;
  const positionStyle: CSSProperties =
    placement === 'above'
      ? { bottom: viewportHeight - menu.cursorTop + MENU_GUTTER, left: menu.left }
      : { top: menu.cursorBottom + MENU_GUTTER, left: menu.left };

  const handleImageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitImage();
  };

  const handleImageInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelImagePrompt();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Insert block"
      data-testid="slash-command-menu"
      data-placement={placement}
      data-stage={menu.stage}
      className="slash-command-menu"
      style={positionStyle}
      onMouseDown={(event) => {
        // Keep the editor selection while clicking menu items.
        if (menu.stage === 'image-url') {
          // The URL input lives inside the menu — let mousedown reach it so
          // the user can click into the field.
          if (event.target instanceof HTMLInputElement) return;
        }
        event.preventDefault();
      }}
    >
      {menu.stage === 'image-url' ? (
        <form
          className="slash-command-image-form"
          data-testid="slash-command-image-form"
          onSubmit={handleImageSubmit}
        >
          <input
            ref={imageInputRef}
            type="url"
            className="slash-command-image-input"
            aria-label="Image URL"
            placeholder="https://"
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            onKeyDown={handleImageInputKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="slash-command-image-actions">
            <button
              type="button"
              className="slash-command-image-button"
              onClick={cancelImagePrompt}
            >
              Cancel
            </button>
            <button type="submit" className="slash-command-image-button is-primary">
              Insert
            </button>
          </div>
        </form>
      ) : filteredItems.length === 0 ? (
        <div className="slash-command-empty">No blocks match &ldquo;{menu.query}&rdquo;</div>
      ) : (
        <ul className="slash-command-list" role="presentation">
          {filteredItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = index === Math.min(activeIndex, filteredItems.length - 1);
            return (
              <li
                key={item.id}
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
                  onClick={() => runItem(item)}
                  data-active={isActive ? 'true' : undefined}
                >
                  <span className="slash-command-icon" aria-hidden="true">
                    <Icon className="size-4" />
                  </span>
                  <span className="slash-command-text">
                    <span className="slash-command-title">{item.title}</span>
                    <span className="slash-command-description">{item.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    portalTarget,
  );
}

export default SlashCommandMenu;
