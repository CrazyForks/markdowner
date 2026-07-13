import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

describe('Dialog overlay', () => {
  afterEach(() => {
    cleanup();
  });

  it('dims the application without applying backdrop blur', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Example dialog</DialogTitle>
          <DialogDescription>Example description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toHaveClass('bg-black/35');
    expect(
      Array.from(overlay?.classList ?? []).some((className) =>
        className.includes('backdrop-blur'),
      ),
    ).toBe(false);
  });
});
