import { describe, expect, it } from 'vitest';

import { syncScrollPosition } from './scrollSync';

function scrollElement({
  clientHeight,
  scrollHeight,
  scrollTop = 0,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop?: number;
}) {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
  element.scrollTop = scrollTop;
  return element;
}

describe('syncScrollPosition', () => {
  it('maps source scroll progress to target scroll progress', () => {
    const source = scrollElement({ clientHeight: 100, scrollHeight: 500, scrollTop: 200 });
    const target = scrollElement({ clientHeight: 100, scrollHeight: 300, scrollTop: 0 });

    syncScrollPosition(source, target);

    expect(target.scrollTop).toBe(100);
  });

  it('resets target scroll when either side cannot scroll', () => {
    const source = scrollElement({ clientHeight: 100, scrollHeight: 100, scrollTop: 80 });
    const target = scrollElement({ clientHeight: 100, scrollHeight: 300, scrollTop: 60 });

    syncScrollPosition(source, target);

    expect(target.scrollTop).toBe(0);
  });

  it('ignores missing targets', () => {
    const source = scrollElement({ clientHeight: 100, scrollHeight: 300, scrollTop: 50 });

    expect(() => syncScrollPosition(source, null)).not.toThrow();
  });
});
