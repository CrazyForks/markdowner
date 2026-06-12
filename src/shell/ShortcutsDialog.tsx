import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DEFAULT_SHELL_BINDINGS,
  KEYMAP_ROWS,
  bindingsEqual,
  captureKeyBindingFromEvent,
  findKeymapConflict,
  formatKeyBinding,
  resolveShellBindings,
  serializeKeyBinding,
  type KeyBinding,
  type KeymapConflict,
  type ShellCommandId,
} from '@/lib/keymap';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keybindingOverrides: Record<string, string>;
  onKeybindingOverridesChange: (next: Record<string, string>) => void;
}

/**
 * Keymap screen: every shortcut in one table, grouped by section. Rows that
 * route through the rebindable shell pipeline can be re-recorded; a capture
 * that collides with a system, fixed, or already-assigned shortcut shows a
 * red warning and cannot be saved.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
  keybindingOverrides,
  onKeybindingOverridesChange,
}: ShortcutsDialogProps) {
  const [editingId, setEditingId] = useState<ShellCommandId | null>(null);
  const [candidate, setCandidate] = useState<KeyBinding | null>(null);
  const [conflict, setConflict] = useState<KeymapConflict | null>(null);

  const effectiveBindings = useMemo(
    () => resolveShellBindings(keybindingOverrides),
    [keybindingOverrides],
  );

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setCandidate(null);
      setConflict(null);
    }
  }, [open]);

  const beginEditing = (commandId: ShellCommandId) => {
    setEditingId(commandId);
    setCandidate(null);
    setConflict(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setCandidate(null);
    setConflict(null);
  };

  const handleRecorderKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
      return;
    }
    if (!editingId) return;
    event.preventDefault();
    event.stopPropagation();
    const captured = captureKeyBindingFromEvent(event);
    if (!captured) return;
    setCandidate(captured);
    setConflict(findKeymapConflict(editingId, captured, keybindingOverrides));
  };

  const saveCandidate = () => {
    if (!editingId || !candidate || conflict) return;
    const next = { ...keybindingOverrides };
    if (bindingsEqual(candidate, DEFAULT_SHELL_BINDINGS[editingId])) {
      delete next[editingId];
    } else {
      next[editingId] = serializeKeyBinding(candidate);
    }
    onKeybindingOverridesChange(next);
    cancelEditing();
  };

  const resetToDefault = (commandId: ShellCommandId) => {
    if (!(commandId in keybindingOverrides)) return;
    const next = { ...keybindingOverrides };
    delete next[commandId];
    onKeybindingOverridesChange(next);
  };

  const sections = useMemo(() => {
    const order: string[] = [];
    const grouped = new Map<string, typeof KEYMAP_ROWS>();
    for (const row of KEYMAP_ROWS) {
      if (!grouped.has(row.section)) {
        grouped.set(row.section, []);
        order.push(row.section);
      }
      grouped.get(row.section)?.push(row);
    }
    return order.map((title) => ({ title, rows: grouped.get(title) ?? [] }));
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Click the pencil to rebind a shortcut, then press the new key
            combination. Conflicting combinations cannot be saved.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <table className="w-full border-collapse text-sm" data-testid="keymap-table">
            <tbody>
              {sections.map((section) => (
                <SectionRows
                  key={section.title}
                  title={section.title}
                  rows={section.rows}
                  effectiveBindings={effectiveBindings}
                  keybindingOverrides={keybindingOverrides}
                  editingId={editingId}
                  candidate={candidate}
                  conflict={conflict}
                  onBeginEditing={beginEditing}
                  onCancelEditing={cancelEditing}
                  onRecorderKeyDown={handleRecorderKeyDown}
                  onSave={saveCandidate}
                  onReset={resetToDefault}
                />
              ))}
            </tbody>
          </table>
        </ScrollArea>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

interface SectionRowsProps {
  title: string;
  rows: typeof KEYMAP_ROWS;
  effectiveBindings: Record<ShellCommandId, KeyBinding>;
  keybindingOverrides: Record<string, string>;
  editingId: ShellCommandId | null;
  candidate: KeyBinding | null;
  conflict: KeymapConflict | null;
  onBeginEditing: (commandId: ShellCommandId) => void;
  onCancelEditing: () => void;
  onRecorderKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onSave: () => void;
  onReset: (commandId: ShellCommandId) => void;
}

function SectionRows({
  title,
  rows,
  effectiveBindings,
  keybindingOverrides,
  editingId,
  candidate,
  conflict,
  onBeginEditing,
  onCancelEditing,
  onRecorderKeyDown,
  onSave,
  onReset,
}: SectionRowsProps) {
  return (
    <>
      <tr>
        <th
          colSpan={3}
          className="pb-1 pt-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-0"
        >
          {title}
        </th>
      </tr>
      {rows.map((row) => {
        const commandId = row.commandId;
        const isEditing = commandId !== undefined && editingId === commandId;
        const keys = commandId
          ? formatKeyBinding(effectiveBindings[commandId])
          : row.fixedKeys ?? '';
        const isOverridden = commandId !== undefined && commandId in keybindingOverrides;
        return (
          <tr key={row.id} className="group border-t border-border/50" data-keymap-row={row.id}>
            <td className="min-w-0 py-1.5 pr-3">
              <span className="block truncate">{row.label}</span>
              {isEditing ? (
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    autoFocus
                    data-testid="keymap-recorder"
                    onKeyDown={onRecorderKeyDown}
                    className="rounded border border-dashed border-ring px-2 py-0.5 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {candidate ? formatKeyBinding(candidate) : 'Press new shortcut…'}
                  </button>
                  <Button type="button" size="sm" variant="secondary" disabled={!candidate || conflict !== null} onClick={onSave}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onCancelEditing}>
                    Cancel
                  </Button>
                  {conflict ? (
                    <span role="alert" className="w-full text-xs text-destructive">
                      Conflicts with “{conflict.label}”
                      {conflict.kind === 'system' ? '' : ' — choose another combination.'}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </td>
            <td className="w-24 py-1.5 text-right align-top">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none">
                {keys}
              </kbd>
            </td>
            <td className="w-14 py-1 pl-2 text-right align-top">
              {commandId ? (
                <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit shortcut for ${row.label}`}
                    onClick={() => onBeginEditing(commandId)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  {isOverridden ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Reset shortcut for ${row.label}`}
                      onClick={() => onReset(commandId)}
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}
