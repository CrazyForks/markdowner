import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TAB_DRAG_DATA_TYPE, Tabs, type TabsItem } from './Tabs';

function tabsItem(id: string, name: string): TabsItem {
  return { id, kind: 'document', name, isDirty: false, missing: false, shortcutLabel: null };
}

// jsdom has no DataTransfer — provide the minimal surface the handlers use.
function dataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    get types() {
      return [...values.keys()];
    },
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value);
    }),
    getData: vi.fn((type: string) => values.get(type) ?? ''),
  };
}

// jsdom lacks DragEvent, so fireEvent drops clientX from drag events. Build
// the event manually and pin the fields the component reads.
function fireDragEventAt(
  node: Element,
  type: 'dragOver' | 'dragLeave' | 'drop',
  clientX: number,
  transfer: ReturnType<typeof dataTransfer>,
) {
  const event = createEvent[type](node);
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  fireEvent(node, event);
}

describe('Tabs drag reordering', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reorders by dragging a tab onto another tab half', () => {
    const onReorderTab = vi.fn();
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md'), tabsItem('c', 'gamma.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );

    const source = screen.getByRole('tab', { name: /alpha\.md/i });
    const target = screen.getByRole('tab', { name: /gamma\.md/i });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      width: 100,
    } as DOMRect);

    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith(TAB_DRAG_DATA_TYPE, 'a');

    // Pointer on the right half of the target → insert after it.
    fireDragEventAt(target, 'dragOver', 280, transfer);
    fireDragEventAt(target, 'drop', 280, transfer);

    expect(onReorderTab).toHaveBeenCalledWith('a', 'c', true);
  });

  it('inserts before the target when dropped on its left half', () => {
    const onReorderTab = vi.fn();
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );

    const source = screen.getByRole('tab', { name: /beta\.md/i });
    const target = screen.getByRole('tab', { name: /alpha\.md/i });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);

    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireDragEventAt(target, 'dragOver', 10, transfer);
    fireDragEventAt(target, 'drop', 10, transfer);

    expect(onReorderTab).toHaveBeenCalledWith('b', 'a', false);
  });

  it('ignores drops onto the dragged tab itself', () => {
    const onReorderTab = vi.fn();
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );

    const source = screen.getByRole('tab', { name: /alpha\.md/i });
    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.drop(source, { dataTransfer: transfer, clientX: 10 });

    expect(onReorderTab).not.toHaveBeenCalled();
  });

  it('keeps tabs non-draggable when no reorder handler is provided', () => {
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /alpha\.md/i })).toHaveAttribute(
      'draggable',
      'false',
    );
  });

  it('publishes an internal drag type without exposing the tab id as plain text', () => {
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={vi.fn()}
      />,
    );

    const transfer = dataTransfer();
    fireEvent.dragStart(screen.getByRole('tab', { name: /alpha\.md/i }), {
      dataTransfer: transfer,
    });

    expect(transfer.setData).toHaveBeenCalledWith(TAB_DRAG_DATA_TYPE, 'a');
    expect(transfer.getData('text/plain')).toBe('');
  });

  it('moves a tab to the end when dropped on the trailing strip area', () => {
    const onReorderTab = vi.fn();
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );

    const source = screen.getByRole('tab', { name: /alpha\.md/i });
    const strip = screen.getByRole('tablist', { name: /open documents/i });
    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireDragEventAt(strip, 'dragOver', 480, transfer);
    fireDragEventAt(strip, 'drop', 480, transfer);

    expect(onReorderTab).toHaveBeenCalledWith('a', null, true);
  });

  it('does not start a tab drag from its close button', () => {
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={vi.fn()}
      />,
    );

    const transfer = dataTransfer();
    const close = screen.getAllByRole('button', { name: /close tab/i })[0];
    expect(close).toHaveAttribute('draggable', 'false');
    fireEvent.dragStart(close, { dataTransfer: transfer });

    expect(transfer.setData).not.toHaveBeenCalled();
  });

  it('scrolls an overflowing strip near either edge and stops at drag end', () => {
    let runFrame: FrameRequestCallback = () => {
      throw new Error('requestAnimationFrame callback was not scheduled');
    };
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        runFrame = callback;
        return 41;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);

    render(
      <Tabs
        items={[
          tabsItem('a', 'alpha.md'),
          tabsItem('b', 'beta.md'),
          tabsItem('c', 'gamma.md'),
        ]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={vi.fn()}
      />,
    );

    const source = screen.getByRole('tab', { name: /alpha\.md/i });
    const target = screen.getByRole('tab', { name: /gamma\.md/i });
    const strip = screen.getByRole('tablist', {
      name: /open documents/i,
    }) as HTMLDivElement;
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 900 },
      scrollLeft: { configurable: true, value: 300, writable: true },
    });
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 300,
      width: 300,
    } as DOMRect);

    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireDragEventAt(target, 'dragOver', 4, transfer);
    expect(requestFrame).toHaveBeenCalled();

    const initialScrollLeft = strip.scrollLeft;
    act(() => runFrame(16));
    expect(strip.scrollLeft).toBeLessThan(initialScrollLeft);

    const afterLeftScroll = strip.scrollLeft;
    fireDragEventAt(target, 'dragOver', 296, transfer);
    act(() => runFrame(32));
    expect(strip.scrollLeft).toBeGreaterThan(afterLeftScroll);

    fireEvent.dragEnd(source, { dataTransfer: transfer });
    expect(cancelFrame).toHaveBeenCalledWith(41);
  });

  it('clears its insertion marker when a drag leaves the strip', () => {
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={vi.fn()}
      />,
    );

    const source = screen.getByRole('tab', { name: /alpha\.md/i });
    const target = screen.getByRole('tab', { name: /beta\.md/i });
    const strip = screen.getByRole('tablist', { name: /open documents/i });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 100,
    } as DOMRect);

    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireDragEventAt(target, 'dragOver', 110, transfer);
    expect(target).toHaveAttribute('data-drop-position', 'before');

    fireDragEventAt(strip, 'dragLeave', -1, transfer);
    expect(target).not.toHaveAttribute('data-drop-position');
  });

  it('renders the Export Preview application tab with its own icon', () => {
    render(
      <Tabs
        items={[
          {
            ...tabsItem('__markdowner_export_preview__', 'Export Preview'),
            kind: 'export',
          },
        ]}
        activeTabId="__markdowner_export_preview__"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /Export Preview/ }).querySelectorAll('svg')).toHaveLength(2);
  });
});
