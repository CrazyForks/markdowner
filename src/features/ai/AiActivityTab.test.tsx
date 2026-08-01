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

    render(<AiActivityTab runs={[run]} onCancel={onCancel} />);

    expect(screen.getByRole('heading', { name: 'Translate document' })).toBeInTheDocument();
    expect(screen.getByText('z-ai/glm-5.2')).toBeInTheDocument();
    expect(screen.getByText('3 / 8')).toBeInTheDocument();
    expect(screen.getByText(/2 of 5 files/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Translate document' }));
    expect(onCancel).toHaveBeenCalledWith('run-1');
  });
});
