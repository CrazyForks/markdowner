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
    const openActivity = vi.fn().mockResolvedValue(undefined);
    const onStart = vi.fn();
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
        onStart={onStart}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([glm]),
          run,
          cancel,
          openActivity,
        }}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'AI task' })).toHaveValue('prd');
    expect(await screen.findByRole('option', { name: /GLM 5.2/ })).toHaveValue(
      'z-ai/glm-5.2',
    );
    expect(screen.getByText(/Estimated input/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        task: 'prd',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    const activityLink = await screen.findByRole('button', {
      name: 'OpenRouter Activity',
    });
    fireEvent.click(activityLink);
    expect(openActivity).toHaveBeenCalledTimes(1);
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
    const modelPricing = vi.fn();
    const run = vi.fn();
    const onOpenSettings = vi.fn();
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
        onOpenSettings={onOpenSettings}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: false,
            maskedLabel: null,
          }),
          listModels,
          modelPricing,
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    expect(await screen.findByText(/Connect OpenRouter/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open AI settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(listModels).not.toHaveBeenCalled();
    expect(modelPricing).not.toHaveBeenCalled();
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

  it('keeps a model override request-local until the user saves it as default', async () => {
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

    expect(onSettingsChange).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as PRD default' }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ aiPrdModel: 'moonshotai/kimi-k3' }),
    );
  });

  it('searches the runtime model catalog by name or slug', async () => {
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
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

    await screen.findByRole('option', { name: /GLM 5.2/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), {
      target: { value: 'kimi' },
    });

    expect(screen.queryByRole('option', { name: /GLM 5.2/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Kimi K3/ })).toBeInTheDocument();
  });

  it('does not silently replace a saved model that is no longer available', async () => {
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
          aiPrdModel: 'vendor/removed-model',
        }}
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

    const modelSelect = await screen.findByRole('combobox', {
      name: 'AI model',
    });
    expect(modelSelect).toHaveValue('vendor/removed-model');
    expect(screen.getByRole('alert')).toHaveTextContent(
      /saved model is unavailable/i,
    );
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('uses live endpoint pricing and waits for it before enabling Run', async () => {
    let resolvePricing: ((pricing: AiModel['pricing']) => void) | undefined;
    const modelPricing = vi.fn(
      () =>
        new Promise<AiModel['pricing']>((resolve) => {
          resolvePricing = resolve;
        }),
    );
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
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
          modelPricing,
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run' });
    await waitFor(() =>
      expect(modelPricing).toHaveBeenCalledWith('z-ai/glm-5.2', true),
    );
    expect(runButton).toBeDisabled();

    resolvePricing?.({
      prompt: 0.000_003,
      completion: 0.000_004,
      updatedAt: '2026-07-31T01:00:00Z',
    });

    await waitFor(() => expect(runButton).toBeEnabled());
    expect(screen.getByText(/2026-07-31T01:00:00Z/)).toBeInTheDocument();
  });

  it('shows Retry-After metadata without automatically retrying a paid request', async () => {
    const run = vi.fn().mockRejectedValue({
      code: 'rate_limited',
      message: 'OpenRouter rate-limited this request.',
      retryAfterSeconds: 12,
    });
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
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
          cancel: vi.fn(),
        }}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    expect(
      await screen.findByText(/Retry after 12 seconds/i),
    ).toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs against an explicitly selected open document and its draft', async () => {
    const run = vi.fn(
      () =>
        new Promise<never>(() => {
          // Keep the request active so only its input contract is under test.
        }),
    );
    render(
      <AiWorkbenchPanel
        documentId="doc-current"
        documentPath="/vault/current.md"
        documentLabel="current.md"
        source="# Current"
        openDocuments={[
          { documentId: 'doc-current', path: '/vault/current.md', label: 'current.md' },
          { documentId: 'doc-other', path: '/vault/other.md', label: 'other.md' },
        ]}
        documentSources={{ 'doc-other': '# Other draft' }}
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: true, maskedLabel: '••••secret' }),
          listModels: vi.fn().mockResolvedValue([glm]),
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    fireEvent.change(await screen.findByRole('combobox', { name: 'Document' }), {
      target: { value: 'doc-other' },
    });
    const runButton = screen.getByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-other',
        source: '# Other draft',
        recordHistory: true,
        scope: expect.objectContaining({ kind: 'document' }),
      }),
      expect.any(Function),
    );
  });

  it('translates workspace Markdown files sequentially without changing the selected model', async () => {
    const run = vi.fn().mockImplementation(async (request) => ({
      requestId: request.requestId,
      documentId: request.documentId,
      task: request.task,
      model: request.model,
      generationId: null,
      result: null,
      validationIssues: [],
      rawDiagnostic: null,
      usage: null,
      retryAfterSeconds: null,
    }));
    const onResult = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-current"
        documentPath="/vault/current.md"
        source="# Current draft"
        workspaceRoot="/vault"
        workspaceDocumentCount={2}
        workspaceDocumentPaths={['/vault/current.md', '/vault/other.md']}
        selection={null}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onSettingsChange={vi.fn()}
        onResult={onResult}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: true, maskedLabel: '••••secret' }),
          listModels: vi.fn().mockResolvedValue([glm]),
          run,
          cancel: vi.fn(),
          readDocuments: vi.fn().mockResolvedValue([
            { path: '/vault/current.md', contents: '# Stale disk copy' },
            { path: '/vault/other.md', contents: '# Other document' },
          ]),
        }}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'AI task' }), {
      target: { value: 'translation' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), {
      target: { value: 'workspace' },
    });
    const runButton = await screen.findByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls.map(([request]) => request.model)).toEqual([
      'z-ai/glm-5.2',
      'z-ai/glm-5.2',
    ]);
    expect(run.mock.calls[0][0]).toMatchObject({
      source: '# Current draft',
      scope: { kind: 'workspace' },
    });
    expect(onResult).toHaveBeenCalledTimes(2);
  });
});
