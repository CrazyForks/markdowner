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

  it('does not fetch a catalog or run a request when no key is configured', async () => {
    const listModels = vi.fn();
    const run = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="Document"
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: false,
            maskedLabel: null,
          }),
          listModels,
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    expect(await screen.findByText(/Connect OpenRouter/i)).toBeInTheDocument();
    expect(listModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(run).not.toHaveBeenCalled();
  });

  it('persists a translation target and blocks a detected same-language request', async () => {
    const onSettingsChange = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="# 요구사항\n\n사용자가 문서를 엽니다."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
          aiTranslationTargetLanguage: 'en',
        }}
        onSettingsChange={onSettingsChange}
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

    fireEvent.change(screen.getByRole('combobox', { name: 'AI task' }), {
      target: { value: 'translation' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Korean · ko/i }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ aiTranslationTargetLanguage: 'ko' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/already appears to be Korean/i);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('persists the selected model as the current task default', async () => {
    const onSettingsChange = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={onSettingsChange}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([
            glm,
            {
              ...glm,
              id: 'moonshotai/kimi-k3',
              name: 'Kimi K3',
            },
          ]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    const modelSelect = await screen.findByRole('combobox', {
      name: 'AI model',
    });
    fireEvent.change(modelSelect, {
      target: { value: 'moonshotai/kimi-k3' },
    });

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ aiPrdModel: 'moonshotai/kimi-k3' }),
    );
  });
});
