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
});
