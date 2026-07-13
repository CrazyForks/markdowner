import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuickOpen } from './QuickOpen';

describe('QuickOpen', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses the same dim-only backdrop as the Command Palette', () => {
    render(<QuickOpen open items={[]} onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    const overlay = document.querySelector('[data-slot="quick-open-overlay"]');
    expect(overlay).toHaveClass('bg-black/35');
    expect(
      Array.from(overlay?.classList ?? []).some((className) =>
        className.includes('backdrop-blur'),
      ),
    ).toBe(false);
  });
});
