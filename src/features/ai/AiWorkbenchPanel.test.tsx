import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';

import { AiWorkbenchPanel } from './AiWorkbenchPanel';
import type { AiModel } from './types';

afterEach(() => cleanup());

const glm: AiModel = {
  id: 'z-ai/glm-5.2',
  name: 'GLM 5.2',
  description: null,
  contextLength: 1_048_576,
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportedParameters: ['structured_outputs', 'response_format'],
  pricing: {
    prompt: 0.000_001,
    completion: 0.000_002,
    updatedAt: '2026-07-31T00:00:00Z',
  },
};

describe('AiWorkbenchPanel', () => {
  it('shows task defaults, estimate, key onboarding, and running cancellation', async () => {
    const run = vi.fn(
      () =>
        new Promise<never>(() => {
          // Intentionally pending so the running/cancel UI remains visible.
        }),
    );
    const cancel = vi.fn().mockResolvedValue(true);
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="# Product\n\nClear requirements."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([glm]),
          run,
          cancel,
        }}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'AI task' })).toHaveValue('prd');
    expect(await screen.findByRole('option', { name: /GLM 5.2/ })).toHaveValue(
      'z-ai/glm-5.2',
    );
    expect(screen.getByText(/Estimated input/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });

  it('blocks execution until cloud disclosure is accepted', async () => {
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="Document"
        selection={null}
        settings={DEFAULT_SETTINGS}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([glm]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Run' })).toBeDisabled();
    expect(screen.getAllByText(/approve cloud processing/i)).not.toHaveLength(0);
  });
});
