import { describe, expect, it, vi } from 'vitest';

import {
  attachMarkdownLinkClickInterceptor,
  findClickedAnchorHref,
  isOpenLinkClick,
} from './linkOpener';

describe('isOpenLinkClick', () => {
  it('treats Cmd+Click as the link-open intent on macOS', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    try {
      expect(isOpenLinkClick({ metaKey: true, ctrlKey: false })).toBe(true);
      expect(isOpenLinkClick({ metaKey: false, ctrlKey: true })).toBe(false);
      expect(isOpenLinkClick({ metaKey: false, ctrlKey: false })).toBe(false);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    }
  });

  it('treats Ctrl+Click as the link-open intent on non-macOS', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
    try {
      expect(isOpenLinkClick({ metaKey: false, ctrlKey: true })).toBe(true);
      expect(isOpenLinkClick({ metaKey: true, ctrlKey: false })).toBe(false);
      expect(isOpenLinkClick({ metaKey: false, ctrlKey: false })).toBe(false);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    }
  });
});

describe('findClickedAnchorHref', () => {
  it('returns the closest anchor href from nested click targets', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a href="./notes.md"><span>Notes</span></a>';
    const target = container.querySelector('span');

    expect(findClickedAnchorHref(target, container)).toBe('./notes.md');
  });

  it('rejects anchors outside the supplied container', () => {
    const container = document.createElement('div');
    const outside = document.createElement('a');
    outside.href = 'https://example.com';

    expect(findClickedAnchorHref(outside, container)).toBeNull();
  });

  it('returns null when the target has no usable href', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a><span>No href</span></a>';
    const target = container.querySelector('span');

    expect(findClickedAnchorHref(target, container)).toBeNull();
  });
});

describe('attachMarkdownLinkClickInterceptor', () => {
  function setup() {
    const surface = document.createElement('div');
    surface.innerHTML = '<p>Read <a href="./next.md"><span>next</span></a></p>';
    surface.addEventListener('click', event => event.preventDefault());
    document.body.appendChild(surface);
    const onInspect = vi.fn();
    const onOpen = vi.fn();
    const cleanup = attachMarkdownLinkClickInterceptor(surface, {
      onInspect,
      onOpen,
    });
    const anchor = surface.querySelector('a') as HTMLAnchorElement;
    const span = surface.querySelector('span') as HTMLElement;
    return { surface, anchor, onInspect, onOpen, cleanup, span };
  }

  it('routes an ordinary anchor click only to inspection', () => {
    const { anchor, onInspect, onOpen, cleanup, span } = setup();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    span.dispatchEvent(event);

    expect(onInspect).toHaveBeenCalledWith(anchor);
    expect(onOpen).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  it('routes Cmd-click only to opening on macOS', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    const { onInspect, onOpen, cleanup, span } = setup();

    try {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      });
      span.dispatchEvent(event);

      expect(onOpen).toHaveBeenCalledWith('./next.md', {
        openInNewTab: true,
      });
      expect(onInspect).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    } finally {
      cleanup();
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    }
  });

  it('routes Ctrl-click only to opening outside macOS', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
    const { onInspect, onOpen, cleanup, span } = setup();

    try {
      span.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      );

      expect(onOpen).toHaveBeenCalledWith('./next.md', {
        openInNewTab: true,
      });
      expect(onInspect).not.toHaveBeenCalled();
    } finally {
      cleanup();
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    }
  });

  it('ignores clicks that miss an anchor and non-left buttons', () => {
    const { surface, onInspect, onOpen, cleanup, span } = setup();

    surface.querySelector('p')?.firstChild?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 }));

    expect(onInspect).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    cleanup();
  });

  it('stops propagation for every handled link click', () => {
    const { surface, cleanup, span } = setup();
    const bubbled = vi.fn();
    surface.addEventListener('click', bubbled);

    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(bubbled).not.toHaveBeenCalled();
    cleanup();
  });

  it('stops firing once cleaned up', () => {
    const { onInspect, onOpen, cleanup, span } = setup();
    cleanup();

    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(onInspect).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
