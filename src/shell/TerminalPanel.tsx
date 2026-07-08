import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { X, Terminal as TerminalIcon } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { listen } from '@tauri-apps/api/event';

import { Button } from '@/components/ui/button';
import {
  closeTerminal,
  resizeTerminal,
  startTerminal,
  TERMINAL_EXIT_EVENT,
  TERMINAL_OUTPUT_EVENT,
  type TerminalExitEvent,
  type TerminalOutputEvent,
  writeTerminal,
} from '@/lib/desktop';
import { resolveSurfaceFocusShortcut } from '@/lib/keyboardShortcuts';
import {
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
  nextTerminalHeightFromKey,
} from '@/lib/terminalPanelState';
import { cn } from '@/lib/utils';

const DEFAULT_TERMINAL_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

function resolveTerminalTextEditingSequence(event: KeyboardEvent): string | null {
  if (event.type !== 'keydown' || event.ctrlKey || event.shiftKey) return null;

  if (event.altKey && !event.metaKey) {
    switch (event.key) {
      case 'ArrowLeft':
        return '\x1bb';
      case 'ArrowRight':
        return '\x1bf';
      case 'ArrowUp':
        return '\x1b[1;3A';
      case 'ArrowDown':
        return '\x1b[1;3B';
      case 'Backspace':
        return '\x17';
      case 'Delete':
        return '\x1bd';
      default:
        return null;
    }
  }

  if (event.metaKey && !event.altKey) {
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        return '\x01';
      case 'ArrowRight':
      case 'ArrowDown':
        return '\x05';
      case 'Backspace':
        return '\x15';
      case 'Delete':
        return '\x0b';
      default:
        return null;
    }
  }

  return null;
}

export interface TerminalPanelHandle {
  focus: () => void;
}

interface TerminalPanelProps {
  fontFamily: string;
  fontSize: number;
  height?: number;
  isResizing?: boolean;
  workingDirectory: string | null;
  onHeightChange?: (height: number) => void;
  onFocusChange?: (focused: boolean) => void;
  onRequestClose?: () => void;
  onRequestFocusEditor?: () => void;
  onResizePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({
  fontFamily,
  fontSize,
  height = TERMINAL_DEFAULT_HEIGHT,
  isResizing = false,
  workingDirectory,
  onHeightChange,
  onFocusChange,
  onRequestClose,
  onRequestFocusEditor,
  onResizePointerDown,
}: TerminalPanelProps, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const onFocusChangeRef = useRef(onFocusChange);
  const onRequestCloseRef = useRef(onRequestClose);
  const onRequestFocusEditorRef = useRef(onRequestFocusEditor);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    onRequestFocusEditorRef.current = onRequestFocusEditor;
  }, [onRequestFocusEditor]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      terminalRef.current?.focus();
    },
  }), []);

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const nextHeight = nextTerminalHeightFromKey(height, event.key);
    if (nextHeight === null) return;
    event.preventDefault();
    onHeightChange?.(nextHeight);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let disposeOutput: (() => void) | null = null;
    let disposeExit: (() => void) | null = null;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      fontFamily: fontFamily.trim() || DEFAULT_TERMINAL_FONT,
      fontSize,
      scrollback: 5000,
      theme: {
        background: '#0b0d10',
        foreground: '#d9e0e8',
        cursor: '#f8fafc',
        selectionBackground: '#64748b66',
      },
    });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    const dataDisposable = terminal.onData((data) => {
      const id = sessionIdRef.current;
      if (id === null) return;
      void writeTerminal(id, data);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true;
      }
      const focusShortcut = resolveSurfaceFocusShortcut(event);
      if (focusShortcut) {
        event.preventDefault();
        event.stopPropagation();
        if (focusShortcut.kind === 'focusEditor') {
          onRequestFocusEditorRef.current?.();
        } else {
          terminal.focus();
          onFocusChangeRef.current?.(true);
        }
        return false;
      }
      const textEditingSequence = resolveTerminalTextEditingSequence(event);
      if (textEditingSequence !== null) {
        event.preventDefault();
        event.stopPropagation();
        const id = sessionIdRef.current;
        if (id !== null) {
          void writeTerminal(id, textEditingSequence);
        }
        return false;
      }
      if (event.altKey || event.shiftKey) {
        return true;
      }
      const closesPanel =
        (event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'w') ||
        (event.ctrlKey &&
          !event.metaKey &&
          (event.code === 'Backquote' || event.key === '`'));
      if (!closesPanel) {
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      onRequestCloseRef.current?.();
      return false;
    });

    const resizeBackend = () => {
      fitAddon.fit();
      const id = sessionIdRef.current;
      if (id !== null) {
        void resizeTerminal(id, terminal.cols, terminal.rows);
      }
    };

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resizeBackend);
      resizeObserver.observe(container);
    }

    const start = async () => {
      disposeOutput = await listen<TerminalOutputEvent>(TERMINAL_OUTPUT_EVENT, (event) => {
        if (event.payload.id === sessionIdRef.current) {
          terminal.write(event.payload.data);
        }
      });
      disposeExit = await listen<TerminalExitEvent>(TERMINAL_EXIT_EVENT, (event) => {
        if (event.payload.id !== sessionIdRef.current) return;
        sessionIdRef.current = null;
        terminal.write('\r\n[process exited]\r\n');
      });

      const session = await startTerminal({
        cwd: workingDirectory,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      if (cancelled) {
        await closeTerminal(session.id);
        return;
      }
      sessionIdRef.current = session.id;
      terminal.focus();
    };

    void start().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      terminal.write(`Failed to start terminal: ${message}\r\n`);
    });

    return () => {
      cancelled = true;
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      onFocusChangeRef.current?.(false);
      resizeObserver?.disconnect();
      disposeOutput?.();
      disposeExit?.();
      dataDisposable.dispose();
      terminal.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
      if (id !== null) {
        void closeTerminal(id);
      }
    };
  }, [fontFamily, fontSize, workingDirectory]);

  return (
    <section
      aria-label="Terminal"
      data-terminal-panel
      data-testid="terminal-panel"
      onBlurCapture={() => onFocusChange?.(false)}
      onFocusCapture={() => onFocusChange?.(true)}
      style={{ height }}
      className="flex min-h-40 shrink-0 flex-col bg-[#0b0d10]"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        aria-valuenow={height}
        aria-valuemin={TERMINAL_MIN_HEIGHT}
        aria-valuemax={TERMINAL_MAX_HEIGHT}
        className={cn(
          'group relative h-1 shrink-0 cursor-row-resize select-none',
          isResizing && 'bg-primary/5',
        )}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={onResizePointerDown}
        tabIndex={0}
        title="Drag to resize terminal"
        style={{ touchAction: 'none' }}
      >
        <div
          className={cn(
            'absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10 transition-colors',
            isResizing ? 'bg-primary' : 'group-hover:bg-primary/60',
          )}
        />
      </div>
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-background px-3">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <TerminalIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-foreground">Terminal</span>
          <code className="min-w-0 truncate text-[11px] text-muted-foreground">
            {workingDirectory || '~'}
          </code>
        </div>
        <Button
          aria-label="Close terminal panel"
          className="size-7"
          onClick={onRequestClose}
          size="icon"
          title="Close terminal panel"
          type="button"
          variant="ghost"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </header>
      <div ref={containerRef} className="min-h-0 flex-1 px-2 py-1" />
    </section>
  );
});
