import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  centerSourceEditorLine,
  centerTiptapEditorLine,
  moveLineBoundaryInProseMirror,
  movePageInProseMirror,
} from './editorNavigation';

afterEach(() => {
  document.body.replaceChildren();
});

describe('centerSourceEditorLine', () => {
  it('scrolls the active source editor line to the viewport center', () => {
    const scrollDOM = document.createElement('div');
    Object.defineProperty(scrollDOM, 'clientHeight', {
      configurable: true,
      value: 200,
    });

    centerSourceEditorLine({
      scrollDOM,
      state: {
        selection: {
          main: {
            head: 5,
          },
        },
      },
      lineBlockAt: vi.fn(() => ({
        top: 300,
        height: 20,
      })),
    } as any);

    expect(scrollDOM.scrollTop).toBe(210);
  });
});

describe('movePageInProseMirror', () => {
  it('moves the caret one viewport page with a two line-height overlap', () => {
    const parent = document.createElement('div');
    Object.defineProperty(parent, 'clientHeight', {
      configurable: true,
      value: 500,
    });
    const dom = document.createElement('div');
    dom.style.lineHeight = '20px';
    parent.appendChild(dom);

    const createSelection = vi.fn((_doc, anchor: number, head: number) => ({
      anchor,
      head,
    }));
    const transaction = {
      setSelection: vi.fn(() => transaction),
      scrollIntoView: vi.fn(() => transaction),
    };
    const state = {
      doc: {
        content: {
          size: 1000,
        },
      },
      selection: {
        anchor: 25,
        head: 25,
        constructor: {
          create: createSelection,
        },
      },
      tr: transaction,
    };
    const view = {
      state,
      dom,
      coordsAtPos: vi.fn(() => ({
        top: 100,
        bottom: 120,
        left: 44,
        right: 64,
      })),
      posAtCoords: vi.fn(({ top }: { left: number; top: number }) => ({
        pos: Math.round(top),
      })),
      dispatch: vi.fn(),
    };

    expect(movePageInProseMirror(view, 1, false)).toBe(true);
    expect(view.posAtCoords).toHaveBeenCalledWith({
      left: 44,
      top: 510,
    });
    expect(createSelection).toHaveBeenCalledWith(state.doc, 510, 510);
    expect(transaction.setSelection).toHaveBeenCalledWith({
      anchor: 510,
      head: 510,
    });
    expect(view.dispatch).toHaveBeenCalledWith(transaction);
  });
});

describe('moveLineBoundaryInProseMirror', () => {
  it('moves to the current visual line boundary and preserves anchor when extending', () => {
    const dom = document.createElement('div');
    dom.getBoundingClientRect = vi.fn(() => ({
      x: 10,
      y: 80,
      width: 300,
      height: 80,
      top: 80,
      right: 310,
      bottom: 160,
      left: 10,
      toJSON: () => ({}),
    }));

    const createSelection = vi.fn((_doc, anchor: number, head: number) => ({
      anchor,
      head,
    }));
    const transaction = {
      setSelection: vi.fn(() => transaction),
      scrollIntoView: vi.fn(() => transaction),
    };
    const state = {
      doc: {
        content: {
          size: 100,
        },
      },
      selection: {
        anchor: 18,
        head: 18,
        constructor: {
          create: createSelection,
        },
      },
      tr: transaction,
    };
    const view = {
      state,
      dom,
      coordsAtPos: vi.fn(() => ({
        top: 100,
        bottom: 120,
        left: 140,
        right: 150,
      })),
      posAtCoords: vi.fn(({ left }: { left: number; top: number }) => ({
        pos: left < 100 ? 3 : 33,
      })),
      dispatch: vi.fn(),
    };

    expect(moveLineBoundaryInProseMirror(view, 'start', true)).toBe(true);
    expect(view.posAtCoords).toHaveBeenCalledWith({
      left: 11,
      top: 110,
    });
    expect(createSelection).toHaveBeenCalledWith(state.doc, 18, 3);
    expect(transaction.setSelection).toHaveBeenCalledWith({
      anchor: 18,
      head: 3,
    });
  });
});

describe('centerTiptapEditorLine', () => {
  it('centers the active ProseMirror selection in the WYSIWYG scroll surface', () => {
    const scrollElement = document.createElement('div');
    scrollElement.dataset.testid = 'editor-surface-wysiwyg';
    Object.defineProperty(scrollElement, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    scrollElement.scrollTop = 50;
    scrollElement.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 100,
      width: 500,
      height: 200,
      top: 100,
      right: 500,
      bottom: 300,
      left: 0,
      toJSON: () => ({}),
    }));
    document.body.appendChild(scrollElement);

    centerTiptapEditorLine({
      view: {
        state: {
          selection: {
            head: 7,
          },
        },
        coordsAtPos: vi.fn(() => ({
          top: 350,
        })),
      },
    });

    expect(scrollElement.scrollTop).toBe(200);
  });
});
