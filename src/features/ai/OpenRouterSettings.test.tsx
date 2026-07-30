import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenRouterSettings } from './OpenRouterSettings';

afterEach(() => cleanup());

describe('OpenRouterSettings', () => {
  it('keeps the key write-only and returns to onboarding after delete', async () => {
    const saveKey = vi.fn().mockResolvedValue({
      configured: true,
      maskedLabel: '••••secret',
    });
    const verifyKey = vi.fn().mockResolvedValue({
      configured: true,
      maskedLabel: '••••secret',
      label: 'Markdowner',
      limit: 10,
      limitRemaining: 9,
      usage: 1,
      expiresAt: null,
      isFreeTier: false,
    });
    const deleteKey = vi.fn().mockResolvedValue({
      configured: false,
      maskedLabel: null,
    });
    render(
      <OpenRouterSettings
        zdrOnly
        disclosureAccepted
        onZdrOnlyChange={vi.fn()}
        onDisclosureAcceptedChange={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: false,
            maskedLabel: null,
          }),
          saveKey,
          verifyKey,
          deleteKey,
        }}
      />,
    );
    await screen.findByText('Connect OpenRouter to use AI tools.');

    fireEvent.change(screen.getByLabelText('OpenRouter API key'), {
      target: { value: 'sk-or-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and verify' }));

    await waitFor(() => expect(saveKey).toHaveBeenCalledWith('sk-or-secret'));
    expect(verifyKey).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue('sk-or-secret')).not.toBeInTheDocument();
    expect(await screen.findByText('Connected as Markdowner')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete key' }));

    await waitFor(() => expect(deleteKey).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Connect OpenRouter to use AI tools.')).toBeInTheDocument();
  });

  it('warns when zero data retention is disabled', async () => {
    render(
      <OpenRouterSettings
        zdrOnly={false}
        disclosureAccepted
        onZdrOnlyChange={vi.fn()}
        onDisclosureAcceptedChange={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: false,
            maskedLabel: null,
          }),
          saveKey: vi.fn(),
          verifyKey: vi.fn(),
          deleteKey: vi.fn(),
        }}
      />,
    );

    expect(
      await screen.findByText(/providers may retain document input and output/i),
    ).toBeInTheDocument();
  });
});
