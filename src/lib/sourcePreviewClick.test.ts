import { describe, expect, it, vi } from 'vitest';

import {
  estimateRenderedTextOffset,
  getRenderedTextOffset,
  mapRenderedTextOffsetToSourceOffset,
  readSourceNumber,
} from './sourcePreviewClick';

describe('readSourceNumber', () => {
  it('reads finite numeric source metadata from dataset values', () => {
    const element = document.createElement('span');
    element.dataset.sourceLine = '12';
    element.dataset.sourceOffset = 'bad';

    expect(readSourceNumber(element, 'sourceLine')).toBe(12);
    expect(readSourceNumber(element, 'sourceOffset')).toBeNull();
    expect(readSourceNumber(element, 'sourceEndOffset')).toBeNull();
  });
});

describe('getRenderedTextOffset', () => {
  it('maps caretPositionFromPoint text nodes to an offset inside the rendered element', () => {
    const element = document.createElement('p');
    element.innerHTML = 'alpha <strong>beta</strong> gamma';
    document.body.appendChild(element);
    const betaTextNode = element.querySelector('strong')?.firstChild;
    expect(betaTextNode).toBeTruthy();

    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: vi.fn(() => ({ offsetNode: betaTextNode, offset: 2 })),
    });

    expect(getRenderedTextOffset(element, 10, 10)).toBe(8);

    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: undefined,
    });
    element.remove();
  });

  it('returns null when browser caret APIs cannot resolve a text location', () => {
    const element = document.createElement('p');

    expect(getRenderedTextOffset(element, 10, 10)).toBeNull();
  });
});

describe('estimateRenderedTextOffset', () => {
  it('estimates a text offset from the click ratio across the element bounds', () => {
    const element = document.createElement('p');
    element.getBoundingClientRect = vi.fn(() => ({
      bottom: 20,
      height: 20,
      left: 10,
      right: 110,
      top: 0,
      width: 100,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    }));

    expect(estimateRenderedTextOffset(element, { clientX: 60 }, 20)).toBe(10);
    expect(estimateRenderedTextOffset(element, { clientX: -10 }, 20)).toBe(0);
    expect(estimateRenderedTextOffset(element, { clientX: 200 }, 20)).toBe(20);
  });
});

describe('mapRenderedTextOffsetToSourceOffset', () => {
  it('anchors rendered text inside the raw source segment when possible', () => {
    const element = document.createElement('span');
    element.textContent = 'Guide';

    expect(
      mapRenderedTextOffsetToSourceOffset(element, '## [Guide](./guide.md)', 0, 21, 2),
    ).toBe(6);
  });

  it('falls back to the raw source offset when rendered text is not found', () => {
    const element = document.createElement('span');
    element.textContent = 'Rendered';

    expect(mapRenderedTextOffsetToSourceOffset(element, 'raw source', 4, 10, 99)).toBe(10);
  });
});
