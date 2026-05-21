import { describe, expect, it } from 'vitest';

import { isOpenLinkClick } from './linkOpener';

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
