import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';
import { AiFeaturePanel } from './AiFeaturePanel';
import type { AiHistoryPage } from './types';

const emptyHistory: AiHistoryPage = {
  items: [],
  page: 0,
  pageSize: 20,
  total: 0,
};

afterEach(cleanup);

describe('AiFeaturePanel', () => {
  it('exposes New, Activity, and History from the global runtime snapshot', async () => {
    const cleanup = vi.fn();
    const runtimeServices = {
      listActive: vi.fn().mockResolvedValue([
        {
          requestId: 'translation-1',
          task: 'translation' as const,
          model: 'z-ai/glm-5.2',
          scope: {
            kind: 'document' as const,
            target: { documentId: 'doc-1', path: '/notes/a.md', label: 'a.md' },
          },
          status: 'running' as const,
          progress: {
            stage: 'translating',
            fileCompleted: 0,
            fileTotal: 1,
            chunkCompleted: 3,
            chunkTotal: 8,
            label: 'a.md',
            receivedCharacters: 0,
          },
          startedAt: 1,
          cancelable: true,
        },
      ]),
      historyPage: vi.fn().mockResolvedValue(emptyHistory),
      listen: vi.fn().mockResolvedValue(cleanup),
    };

    render(
      <AiFeaturePanel
        documentId="doc-1"
        documentPath="/notes/a.md"
        source="# A"
        selection={null}
        settings={DEFAULT_SETTINGS}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        runtimeServices={runtimeServices}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: false, maskedLabel: null }),
          listModels: vi.fn().mockResolvedValue([]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole('tab', { name: 'New' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('1 AI request running')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Activity (1)' }));
    expect(await screen.findByRole('heading', { name: 'Translate document' })).toBeVisible();
    expect(screen.getByText('3 / 8')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('No saved AI runs yet.')).toBeVisible();
    await waitFor(() => expect(runtimeServices.historyPage).toHaveBeenCalledWith(0, 20));
  });

  it('keeps the History view available when local retention is disabled', () => {
    render(
      <AiFeaturePanel
        documentId="doc-1"
        source="# A"
        selection={null}
        settings={{ ...DEFAULT_SETTINGS, aiHistoryEnabled: false }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        runtimeServices={{
          listActive: vi.fn().mockResolvedValue([]),
          historyPage: vi.fn().mockResolvedValue(emptyHistory),
          listen: vi.fn().mockResolvedValue(vi.fn()),
        }}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: false, maskedLabel: null }),
          listModels: vi.fn().mockResolvedValue([]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByText('Local history is off')).toBeVisible();
  });
});
