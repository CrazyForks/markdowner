import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';

import { AiSelectionPopover } from './AiSelectionPopover';
import { captureSourceSelection } from './selection';

afterEach(cleanup);

describe('AiSelectionPopover', () => {
  it('runs a custom prompt against the captured range without mutating it first', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const run = vi.fn(async (request) => ({
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
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onClose={vi.fn()}
        onResult={onResult}
        services={{
          keyStatus: vi.fn(async () => ({
            configured: true,
            maskedLabel: 'sk-or-…test',
          })),
          listModels: vi.fn(async () => [
            {
              id: 'z-ai/glm-5.2',
              name: 'GLM 5.2',
              description: null,
              contextLength: 131_072,
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportedParameters: ['structured_outputs'],
              pricing: {
                prompt: 0.0000001,
                completion: 0.0000001,
                updatedAt: '2026-07-31T00:00:00Z',
              },
            },
          ]),
          run,
          cancel: vi.fn(async () => true),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Prompt for selected text'), {
      target: { value: 'Make this uppercase' },
    });
    const runButton = screen.getByRole('button', { name: 'Run on selection' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0]).toMatchObject({
      documentId: 'doc-1',
      source: 'alpha beta',
      selection: { start: 6, end: 10 },
      task: 'custom',
      instruction: 'Make this uppercase',
    });
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape before a request starts', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const onClose = vi.fn();

    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onClose={onClose}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn(async () => ({
            configured: false,
            maskedLabel: null,
          })),
          listModels: vi.fn(),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    await screen.findByText(/Add and verify an OpenRouter key/i);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selects presets without running and delegates local-agent actions', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const run = vi.fn();
    const onLocalAgent = vi.fn();

    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onClose={vi.fn()}
        onResult={vi.fn()}
        onLocalAgent={onLocalAgent}
        services={{
          keyStatus: vi.fn(async () => ({ configured: true, maskedLabel: 'sk-or-…test' })),
          listModels: vi.fn(async () => []),
          run,
          cancel: vi.fn(async () => true),
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Improve' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make table' }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use local agent' }));
    expect(onLocalAgent).toHaveBeenCalledWith(snapshot);
    expect(run).not.toHaveBeenCalled();
  });

  it('focuses the custom instruction field when selected', () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={DEFAULT_SETTINGS}
        onClose={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn(async () => ({ configured: false, maskedLabel: null })),
          listModels: vi.fn(),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Custom instruction' }));
    expect(screen.getByLabelText('Prompt for selected text')).toHaveFocus();
  });
});
