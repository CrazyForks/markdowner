import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import { reloadActiveDocumentFromDisk } from './desktop';

describe('desktop document reload', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('invokes the dedicated disk reload command instead of opening the cached document', async () => {
    const snapshot = {
      activeDocumentName: 'notes.md',
      activeDocumentPath: '/tmp/notes.md',
      activeDocumentSource: '# Updated',
      activeDocumentDirty: false,
      rootDir: null,
      workspaceDocuments: [],
      recentDocuments: [],
      mode: 'Editor' as const,
      theme: { kind: 'BuiltInDark' as const },
      lastError: null,
    };
    invokeMock.mockResolvedValue(snapshot);

    await expect(
      reloadActiveDocumentFromDisk({
        path: '/tmp/notes.md',
        expectedSource: '# Previous',
        expectedDirty: false,
      }),
    ).resolves.toEqual(snapshot);

    expect(invokeMock).toHaveBeenCalledWith('reload_active_document_from_disk', {
      path: '/tmp/notes.md',
      expectedSource: '# Previous',
      expectedDirty: false,
    });
  });
});
