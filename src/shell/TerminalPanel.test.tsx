import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TERMINAL_OUTPUT_EVENT, type TerminalOutputEvent } from '@/lib/desktop';

import { TerminalPanel } from './TerminalPanel';
import type { TerminalPanelHandle } from './TerminalPanel';

const listenMock = vi.hoisted(() => vi.fn());
const startTerminalMock = vi.hoisted(() => vi.fn());
const writeTerminalMock = vi.hoisted(() => vi.fn());
const resizeTerminalMock = vi.hoisted(() => vi.fn());
const closeTerminalMock = vi.hoisted(() => vi.fn());
const terminalInstances = vi.hoisted(() => [] as any[]);

type ListenerPayload<T> = { payload: T };
const eventListeners = new Map<string, (event: ListenerPayload<any>) => void>();

vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    open = vi.fn();
    loadAddon = vi.fn();
    focus = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    private dataHandler: ((data: string) => void) | null = null;
    private focusHandler: (() => void) | null = null;
    private blurHandler: (() => void) | null = null;
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null;

    constructor() {
      terminalInstances.push(this);
    }

    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    }

    onFocus(handler: () => void) {
      this.focusHandler = handler;
      return { dispose: vi.fn() };
    }

    onBlur(handler: () => void) {
      this.blurHandler = handler;
      return { dispose: vi.fn() };
    }

    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keyHandler = handler;
    }

    emitData(data: string) {
      this.dataHandler?.(data);
    }

    emitFocus() {
      this.focusHandler?.();
    }

    emitBlur() {
      this.blurHandler?.();
    }
  }

  return { Terminal: FakeTerminal };
});
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FakeFitAddon {
    fit = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));
vi.mock('@/lib/desktop', () => ({
  TERMINAL_EXIT_EVENT: 'markdowner://terminal-exit',
  TERMINAL_OUTPUT_EVENT: 'markdowner://terminal-output',
  closeTerminal: closeTerminalMock,
  resizeTerminal: resizeTerminalMock,
  startTerminal: startTerminalMock,
  writeTerminal: writeTerminalMock,
}));

describe('TerminalPanel', () => {
  beforeEach(() => {
    terminalInstances.length = 0;
    eventListeners.clear();
    listenMock.mockReset();
    listenMock.mockImplementation(async (eventName: string, handler: (event: ListenerPayload<any>) => void) => {
      eventListeners.set(eventName, handler);
      return vi.fn();
    });
    startTerminalMock.mockReset();
    startTerminalMock.mockResolvedValue({ id: 7 });
    writeTerminalMock.mockReset();
    writeTerminalMock.mockResolvedValue(undefined);
    resizeTerminalMock.mockReset();
    resizeTerminalMock.mockResolvedValue(undefined);
    closeTerminalMock.mockReset();
    closeTerminalMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('starts a pty, writes backend output, forwards user input, and closes on unmount', async () => {
    const { unmount } = render(
      <TerminalPanel
        fontFamily="JetBrains Mono"
        fontSize={14}
        workingDirectory="/tmp/project"
      />,
    );

    await waitFor(() => {
      expect(startTerminalMock).toHaveBeenCalledWith({
        cwd: '/tmp/project',
        cols: 80,
        rows: 24,
      });
    });
    const terminal = terminalInstances[0];

    await act(async () => {
      eventListeners.get(TERMINAL_OUTPUT_EVENT)?.({
        payload: { id: 7, data: 'hello\r\n' } satisfies TerminalOutputEvent,
      });
    });
    expect(terminal.write).toHaveBeenCalledWith('hello\r\n');

    terminal.emitData('ls\r');
    expect(writeTerminalMock).toHaveBeenCalledWith(7, 'ls\r');

    unmount();

    await waitFor(() => {
      expect(closeTerminalMock).toHaveBeenCalledWith(7);
    });
  });

  it('reports focus changes and reserves close shortcuts inside xterm', async () => {
    const onFocusChange = vi.fn();
    const onRequestClose = vi.fn();
    render(
      <TerminalPanel
        fontFamily=""
        fontSize={13}
        onFocusChange={onFocusChange}
        onRequestClose={onRequestClose}
        workingDirectory={null}
      />,
    );

    await waitFor(() => {
      expect(startTerminalMock).toHaveBeenCalled();
    });
    const terminal = terminalInstances[0];

    const panel = screen.getByTestId('terminal-panel');
    fireEvent.focus(panel);
    fireEvent.blur(panel);
    expect(onFocusChange).toHaveBeenNthCalledWith(1, true);
    expect(onFocusChange).toHaveBeenNthCalledWith(2, false);

    const cmdW = new KeyboardEvent('keydown', { key: 'w', metaKey: true });
    const cmdWStopPropagation = vi.spyOn(cmdW, 'stopPropagation');
    expect(terminal.keyHandler?.(cmdW)).toBe(false);
    expect(cmdWStopPropagation).toHaveBeenCalled();
    expect(onRequestClose).toHaveBeenCalledTimes(1);

    const ctrlBackquote = new KeyboardEvent('keydown', {
      code: 'Backquote',
      key: '`',
      ctrlKey: true,
    });
    const ctrlBackquoteStopPropagation = vi.spyOn(ctrlBackquote, 'stopPropagation');
    expect(terminal.keyHandler?.(ctrlBackquote)).toBe(false);
    expect(ctrlBackquoteStopPropagation).toHaveBeenCalled();
    expect(onRequestClose).toHaveBeenCalledTimes(2);
  });

  it('exposes an imperative focus handle and editor focus shortcut for xterm focus', async () => {
    const ref = createRef<TerminalPanelHandle>();
    const onRequestFocusEditor = vi.fn();
    render(
      <TerminalPanel
        ref={ref}
        fontFamily=""
        fontSize={13}
        onRequestFocusEditor={onRequestFocusEditor}
        workingDirectory={null}
      />,
    );

    await waitFor(() => {
      expect(startTerminalMock).toHaveBeenCalled();
    });
    const terminal = terminalInstances[0];
    terminal.focus.mockClear();

    act(() => {
      ref.current?.focus();
    });
    expect(terminal.focus).toHaveBeenCalledTimes(1);

    const focusEditor = new KeyboardEvent('keydown', {
      key: 'e',
      metaKey: true,
      altKey: true,
    });
    const stopPropagation = vi.spyOn(focusEditor, 'stopPropagation');
    expect(terminal.keyHandler?.(focusEditor)).toBe(false);
    expect(stopPropagation).toHaveBeenCalled();
    expect(onRequestFocusEditor).toHaveBeenCalledTimes(1);
  });

  it('renders a draggable terminal resize separator', async () => {
    const onResizePointerDown = vi.fn();
    render(
      <TerminalPanel
        fontFamily=""
        fontSize={13}
        height={320}
        onResizePointerDown={onResizePointerDown}
        workingDirectory={null}
      />,
    );

    await waitFor(() => {
      expect(startTerminalMock).toHaveBeenCalled();
    });

    const separator = screen.getByRole('separator', { name: /resize terminal/i });
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
    expect(separator).toHaveAttribute('aria-valuenow', '320');
    expect(separator).toHaveAttribute('aria-valuemin', '160');
    expect(separator).toHaveAttribute('aria-valuemax', '720');
    expect(separator).toHaveClass('cursor-row-resize');
    expect(separator).toHaveStyle({ touchAction: 'none' });

    fireEvent.pointerDown(separator, { clientY: 420 });
    expect(onResizePointerDown).toHaveBeenCalled();
  });
});
