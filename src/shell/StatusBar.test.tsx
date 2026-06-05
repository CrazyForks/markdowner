import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusBar } from './StatusBar';

describe('StatusBar update badge', () => {
  afterEach(() => cleanup());

  it('hides the update badge when no update is available', () => {
    render(<StatusBar mode="Wysiwyg" theme="Light" />);
    expect(screen.queryByTestId('statusbar-update-badge')).toBeNull();
  });

  it('shows the badge and fires onUpdateClick', () => {
    const onUpdateClick = vi.fn();
    render(
      <StatusBar mode="Wysiwyg" theme="Light" updateAvailable onUpdateClick={onUpdateClick} />,
    );
    const badge = screen.getByTestId('statusbar-update-badge');
    fireEvent.click(badge);
    expect(onUpdateClick).toHaveBeenCalledTimes(1);
  });
});
