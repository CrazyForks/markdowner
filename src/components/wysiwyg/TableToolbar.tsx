import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  PanelBottomDashed,
  PanelLeftDashed,
  PanelRightDashed,
  PanelTop,
  PanelTopDashed,
  TableProperties,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  editor: Editor | null;
  /** When false, listeners are detached and nothing is rendered. */
  enabled?: boolean;
}

type Position = { top: number; left: number };
type TableCommand =
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'deleteRow'
  | 'deleteTable'
  | 'toggleHeaderRow';

const TOOLBAR_OFFSET_PX = 10;
const TABLE_DRAG_SELECTION_THRESHOLD_PX = 4;

type RecordLike = Record<string, unknown>;

interface TableCellSelection {
  from?: unknown;
  $anchorCell?: RecordLike;
  $headCell?: RecordLike;
}

interface PendingTableMouseDrag {
  startX: number;
  startY: number;
  dragging: boolean;
}

function isRecordLike(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null;
}

function isTableCellSelection(selection: unknown): selection is TableCellSelection {
  if (!isRecordLike(selection)) return false;
  return isRecordLike(selection.$anchorCell) && isRecordLike(selection.$headCell);
}

function getCellTextSelectionPosition(selection: TableCellSelection): number | null {
  const headCellPosition = selection.$headCell?.pos;
  if (typeof headCellPosition === 'number' && Number.isFinite(headCellPosition)) {
    return headCellPosition + 1;
  }

  if (typeof selection.from === 'number' && Number.isFinite(selection.from)) {
    return selection.from;
  }

  return null;
}

function isTableCellTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('td, th'));
}

export function TableToolbar({ editor, enabled = true }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const computePosition = useCallback((): Position | null => {
    if (!editor || !editor.isActive('table')) return null;
    const { state, view } = editor;
    if (!view.hasFocus()) return null;
    if (isTableCellSelection(state.selection)) return null;

    const { from, to } = state.selection;
    let startCoords: { top: number; bottom: number; left: number };
    let endCoords: { top: number; bottom: number; right: number };
    try {
      startCoords = view.coordsAtPos(from);
      endCoords = view.coordsAtPos(to, 1);
    } catch {
      // Adding/removing rows or columns briefly leaves the view without
      // measurable geometry. Hide for this frame; the table 'update' event
      // we listen to will re-fire once the new structure has laid out.
      return null;
    }
    const top = Math.min(startCoords.top, endCoords.top);
    const left = (startCoords.left + endCoords.right) / 2;

    if (!Number.isFinite(top) || !Number.isFinite(left)) return null;

    return {
      top: top - TOOLBAR_OFFSET_PX,
      left,
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !enabled) {
      setVisible(false);
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
        const next = computePosition();
        if (!next) {
          setVisible(false);
          return;
        }
        setPosition(next);
        setVisible(true);
      });
    };

    const handleBlur = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (toolbarRef.current && active && toolbarRef.current.contains(active)) return;
        setVisible(false);
      }, 50);
    };

    editor.on('selectionUpdate', schedule);
    editor.on('transaction', schedule);
    editor.on('update', schedule);
    editor.on('blur', handleBlur);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      editor.off('selectionUpdate', schedule);
      editor.off('transaction', schedule);
      editor.off('update', schedule);
      editor.off('blur', handleBlur);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [editor, enabled, computePosition]);

  useEffect(() => {
    if (!editor || !enabled) return;

    const editorDom = editor.view?.dom;
    if (!(editorDom instanceof HTMLElement)) return;

    const ownerDocument = editorDom.ownerDocument;
    let pendingDrag: PendingTableMouseDrag | null = null;
    let settleFrame: number | null = null;

    const clearAccidentalCellSelection = () => {
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);

      settleFrame = requestAnimationFrame(() => {
        settleFrame = null;
        const selection = editor.state.selection;
        if (!isTableCellSelection(selection)) return;

        const textPosition = getCellTextSelectionPosition(selection);
        if (textPosition === null) return;

        editor.commands.setTextSelection(textPosition);
        if (typeof editor.view.focus === 'function') {
          editor.view.focus();
        }
      });
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
      if (!isTableCellTarget(event.target)) return;

      pendingDrag = {
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      };
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!pendingDrag) return;
      if (event.buttons !== 0 && (event.buttons & 1) === 0) {
        pendingDrag = null;
        return;
      }

      const distance = Math.hypot(
        event.clientX - pendingDrag.startX,
        event.clientY - pendingDrag.startY,
      );

      if (distance < TABLE_DRAG_SELECTION_THRESHOLD_PX) {
        event.stopPropagation();
        return;
      }

      pendingDrag.dragging = true;
      setVisible(false);
    };

    const handleMouseUp = () => {
      if (!pendingDrag) return;

      const wasDragging = pendingDrag.dragging;
      pendingDrag = null;

      if (!wasDragging) {
        clearAccidentalCellSelection();
      }
    };

    const handleCancel = () => {
      pendingDrag = null;
    };

    editorDom.addEventListener('mousedown', handleMouseDown, true);
    editorDom.addEventListener('mousemove', handleMouseMove, true);
    editorDom.addEventListener('mouseup', handleMouseUp, true);
    editorDom.addEventListener('dragstart', handleCancel, true);
    ownerDocument.addEventListener('mousemove', handleMouseMove, true);
    ownerDocument.addEventListener('mouseup', handleMouseUp, true);
    ownerDocument.addEventListener('dragstart', handleCancel, true);

    return () => {
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      editorDom.removeEventListener('mousedown', handleMouseDown, true);
      editorDom.removeEventListener('mousemove', handleMouseMove, true);
      editorDom.removeEventListener('mouseup', handleMouseUp, true);
      editorDom.removeEventListener('dragstart', handleCancel, true);
      ownerDocument.removeEventListener('mousemove', handleMouseMove, true);
      ownerDocument.removeEventListener('mouseup', handleMouseUp, true);
      ownerDocument.removeEventListener('dragstart', handleCancel, true);
    };
  }, [editor, enabled]);

  const runCommand = (command: TableCommand) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (command) {
      case 'addColumnBefore':
        chain.addColumnBefore().run();
        break;
      case 'addColumnAfter':
        chain.addColumnAfter().run();
        break;
      case 'deleteColumn':
        chain.deleteColumn().run();
        break;
      case 'addRowBefore':
        chain.addRowBefore().run();
        break;
      case 'addRowAfter':
        chain.addRowAfter().run();
        break;
      case 'deleteRow':
        chain.deleteRow().run();
        break;
      case 'deleteTable':
        chain.deleteTable().run();
        break;
      case 'toggleHeaderRow':
        chain.toggleHeaderRow().run();
        break;
    }
  };

  if (!enabled || !visible) return null;

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Table editing"
      data-testid="table-toolbar"
      className="table-toolbar"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <TableToolbarButton
        label="Add column before"
        onClick={() => runCommand('addColumnBefore')}
      >
        <PanelLeftDashed className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Add column after"
        onClick={() => runCommand('addColumnAfter')}
      >
        <PanelRightDashed className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Delete column"
        danger
        onClick={() => runCommand('deleteColumn')}
      >
        <Trash2 className="size-4" />
      </TableToolbarButton>
      <span aria-hidden className="table-toolbar-separator" />
      <TableToolbarButton
        label="Add row before"
        onClick={() => runCommand('addRowBefore')}
      >
        <PanelTopDashed className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Add row after"
        onClick={() => runCommand('addRowAfter')}
      >
        <PanelBottomDashed className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Delete row"
        danger
        onClick={() => runCommand('deleteRow')}
      >
        <Trash2 className="size-4" />
      </TableToolbarButton>
      <span aria-hidden className="table-toolbar-separator" />
      <TableToolbarButton
        label="Toggle header row"
        onClick={() => runCommand('toggleHeaderRow')}
      >
        <PanelTop className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Delete table"
        danger
        onClick={() => runCommand('deleteTable')}
      >
        <TableProperties className="size-4" />
      </TableToolbarButton>
    </div>,
    portalTarget,
  );
}

interface TableToolbarButtonProps {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function TableToolbarButton({ label, danger = false, onClick, children }: TableToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('table-toolbar-button', danger && 'is-danger')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default TableToolbar;
