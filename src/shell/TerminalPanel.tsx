import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { X, Terminal as TerminalIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
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

const DEFAULT_TERMINAL_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

interface TerminalPanelProps {
  fontFamily: string;
  fontSize: number;
  workingDirectory: string | null;
  onFocusChange?: (focused: boolean) => void;
  onRequestClose?: () => void;
}

export function TerminalPanel({
  fontFamily,
  fontSize,
  workingDirectory,
  onFocusChange,
  onRequestClose,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const onFocusChangeRef = useRef(onFocusChange);
  const onRequestCloseRef = useRef(onRequestClose);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

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
      if (event.type !== 'keydown' || event.altKey || event.shiftKey) {
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
      if (id !== null) {
        void closeTerminal(id);
      }
    };
  }, [fontFamily, fontSize, workingDirectory]);

  return (
    <section
      aria-label="Terminal"
      className="flex h-64 min-h-40 max-h-[40vh] shrink-0 flex-col border-t border-border bg-[#0b0d10]"
      data-terminal-panel
      data-testid="terminal-panel"
      onBlurCapture={() => onFocusChange?.(false)}
      onFocusCapture={() => onFocusChange?.(true)}
    >
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
}
