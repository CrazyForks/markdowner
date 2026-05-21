import type { EditorView } from '@uiw/react-codemirror';

export function centerSourceEditorLine(view: EditorView) {
  const scrollElement = view.scrollDOM;
  if (!scrollElement || scrollElement.clientHeight <= 0) return;

  const selectionHead = view.state.selection.main.head;
  const lineBlock = view.lineBlockAt(selectionHead);
  const nextScrollTop = Math.max(
    0,
    lineBlock.top + lineBlock.height / 2 - scrollElement.clientHeight / 2,
  );

  if (Number.isFinite(nextScrollTop)) {
    scrollElement.scrollTop = nextScrollTop;
  }
}

/**
 * Move the ProseMirror caret by one viewport page.
 * Browser contenteditable surfaces only scroll on PageUp/PageDown by default;
 * this brings the caret along and extends the selection when requested.
 */
export function movePageInProseMirror(
  view: any,
  direction: 1 | -1,
  extend: boolean,
): boolean {
  const state = view?.state;
  if (!state) return false;
  const head = state.selection.head;
  const headCoords = view.coordsAtPos(head);

  const viewportHeight =
    view.dom.parentElement?.clientHeight ||
    view.dom.clientHeight ||
    window.innerHeight;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;

  const step = direction * Math.max(viewportHeight * 0.9, 40);
  const computedStyle = window.getComputedStyle(view.dom);
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
  const parsedFontSize = Number.parseFloat(computedStyle.fontSize);
  const fallbackLineHeight = Number.isFinite(parsedFontSize) && parsedFontSize > 0
    ? parsedFontSize * 1.4
    : 20;
  const lineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
    ? parsedLineHeight
    : fallbackLineHeight;
  const targetY = headCoords.top + step - lineHeight * 2;
  const found = view.posAtCoords({ left: headCoords.left, top: targetY });
  const targetPos = found?.pos ?? (direction > 0 ? state.doc.content.size : 0);

  const SelectionCtor = state.selection.constructor as {
    create: (doc: any, anchor: number, head?: number) => any;
  };
  const anchor = extend ? state.selection.anchor : targetPos;
  const nextSelection = SelectionCtor.create(state.doc, anchor, targetPos);
  view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
  return true;
}

export function moveLineBoundaryInProseMirror(
  view: any,
  boundary: 'start' | 'end',
  extend: boolean,
): boolean {
  const state = view?.state;
  const dom = view?.dom as HTMLElement | undefined;
  if (!state || !dom) return false;

  const head = state.selection.head;
  const headCoords = view.coordsAtPos(head);
  const editorRect = dom.getBoundingClientRect();
  const targetY = (headCoords.top + headCoords.bottom) / 2;
  const targetX = boundary === 'start'
    ? editorRect.left + 1
    : editorRect.right - 1;
  const found = view.posAtCoords({ left: targetX, top: targetY });
  if (!found || typeof found.pos !== 'number') return false;

  const SelectionCtor = state.selection.constructor as {
    create: (doc: any, anchor: number, head?: number) => any;
  };
  const targetPos = found.pos;
  const anchor = extend ? state.selection.anchor : targetPos;
  const nextSelection = SelectionCtor.create(state.doc, anchor, targetPos);
  view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
  return true;
}

export function centerTiptapEditorLine(editor: any, doc: Document = document) {
  const scrollElement = doc.querySelector('[data-testid="editor-surface-wysiwyg"]');
  if (!scrollElement || scrollElement.clientHeight <= 0) return;

  const { view } = editor;
  if (!view || !view.state) return;
  const { selection } = view.state;

  try {
    const coords = view.coordsAtPos(selection.head);
    const scrollRect = scrollElement.getBoundingClientRect();
    const offsetToCenter = coords.top - scrollRect.top + scrollElement.scrollTop;

    const nextScrollTop = Math.max(0, offsetToCenter - scrollElement.clientHeight / 2);

    if (Number.isFinite(nextScrollTop)) {
      scrollElement.scrollTop = nextScrollTop;
    }
  } catch {
    // coordsAtPos can fail if the position is not drawn yet.
  }
}
