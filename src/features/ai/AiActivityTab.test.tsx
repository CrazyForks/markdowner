import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiActivityTab } from './AiActivityTab';
import type { AiActiveRun } from './types';

afterEach(() => cleanup());

describe('AiActivityTab', () => {
  it('renders global translation progress and cancels the selected run', () => {
    const onCancel = vi.fn();
    const run: AiActiveRun = {
      requestId: 'run-1',
      task: 'translation',
      model: 'z-ai/glm-5.2',
      scope: {
        kind: 'workspace',
        rootPath: '/vault',
        target: null,
        documentCount: 5,
      },
      status: 'running',
      progress: {
        stage: 'translating',
        fileCompleted: 2,
        fileTotal: 5,
        chunkCompleted: 3,
        chunkTotal: 8,
        label: 'Architecture',
        receivedCharacters: 420,
      },
      startedAt: 10,
      cancelable: true,
    };

    render(<AiActivityTab runs={[run]} nowSeconds={134} onCancel={onCancel} />);

    expect(screen.getByRole('heading', { name: 'Translate document' })).toBeInTheDocument();
    expect(screen.getByText('z-ai/glm-5.2')).toBeInTheDocument();
    expect(screen.getByText('Files 2/5 · Chunks 3/8 · Architecture')).toBeInTheDocument();
    expect(screen.getByText(/2m 4s elapsed/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Translate document progress' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Translate document' }));
    expect(onCancel).toHaveBeenCalledWith('run-1');
  });

  it('labels and cancels a Summary run independently', () => {
    const onCancel = vi.fn();
    const run: AiActiveRun = {
      requestId: 'summary-run',
      task: 'summary',
      model: 'z-ai/glm-5.2',
      scope: {
        kind: 'document',
        target: { documentId: 'doc-1', path: '/notes.md', label: 'notes.md' },
      },
      status: 'running',
      progress: {
        stage: 'streaming',
        fileCompleted: null,
        fileTotal: null,
        chunkCompleted: null,
        chunkTotal: null,
        label: null,
        receivedCharacters: 120,
      },
      startedAt: 10,
      cancelable: true,
    };

    render(<AiActivityTab runs={[run]} nowSeconds={20} onCancel={onCancel} />);

    expect(screen.getByRole('heading', { name: 'Summarize document' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Summarize document' }));
    expect(onCancel).toHaveBeenCalledWith('summary-run');
  });
});
