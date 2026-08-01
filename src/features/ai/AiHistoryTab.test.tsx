import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiHistoryTab } from './AiHistoryTab';
import type { AiHistoryDetail, AiHistoryPage } from './types';

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const run: AiHistoryDetail = {
  id: 'run-1',
  task: 'prd',
  model: 'z-ai/glm-5.2',
  status: 'completed',
  scopeJson: JSON.stringify({ kind: 'document', target: { label: 'PRD.md' } }),
  sourceHash: 'sha256-only',
  promptVersion: 'ai-v2',
  resultJson: JSON.stringify({ summary: 'Validated PRD result' }),
  errorJson: JSON.stringify({ message: 'No error' }),
  usageJson: JSON.stringify({
    promptTokens: 120,
    completionTokens: 30,
    totalTokens: 150,
    costUsd: 0.0042,
  }),
  startedAt: 100,
  finishedAt: 103,
  interviewTurns: [
    { position: 1, question: 'Who is this for?', answer: 'Product teams', skipped: false },
  ],
};

const page: AiHistoryPage = { items: [run], page: 0, pageSize: 20, total: 21 };

describe('AiHistoryTab', () => {
  it('pages, opens complete detail, deletes, and clears without exposing source content', async () => {
    const onPageChange = vi.fn();
    const detail = vi.fn().mockResolvedValue(run);
    const deleteRun = vi.fn().mockResolvedValue(true);
    const clear = vi.fn().mockResolvedValue(1);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <AiHistoryTab
        history={page}
        loading={false}
        error={null}
        onPageChange={onPageChange}
        onReload={vi.fn()}
        services={{ detail, deleteRun, clear }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next history page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: /Open run run-1/i }));
    await waitFor(() => expect(detail).toHaveBeenCalledWith('run-1'));
    expect(screen.getByRole('heading', { name: 'Improve PRD' })).toBeInTheDocument();
    expect(screen.getByText('PRD.md')).toBeInTheDocument();
    expect(screen.getByText('Who is this for?')).toBeInTheDocument();
    expect(screen.getByText('Product teams')).toBeInTheDocument();
    expect(screen.getByText('Validated PRD result')).toBeInTheDocument();
    expect(screen.getByText('No error')).toBeInTheDocument();
    expect(screen.getByText(/120 prompt · 30 completion/i)).toBeInTheDocument();
    expect(screen.getByText(/USD 0.0042/i)).toBeInTheDocument();
    expect(screen.getByText('3 seconds')).toBeInTheDocument();
    expect(screen.queryByText(/full source body/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete run run-1' }));
    await waitFor(() => expect(deleteRun).toHaveBeenCalledWith('run-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  });
});
