import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import {
  exportPdfFile,
  exportPdfFiles,
  exportTextFiles,
  reloadActiveDocumentFromDisk,
} from './desktop';

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

describe('desktop export bridge', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it('passes batch HTML files to the native writer', async () => {
    const files = [{ path: '/tmp/exports/a.html', contents: '<h1>A</h1>' }];

    await exportTextFiles(files);

    expect(invokeMock).toHaveBeenCalledWith('write_export_files', { files });
  });

  it('passes explicit paper dimensions for single and batch PDF exports', async () => {
    await exportPdfFile('/tmp/a.pdf', '<h1>A</h1>', 297, 210);
    expect(invokeMock).toHaveBeenLastCalledWith('write_pdf_file', {
      path: '/tmp/a.pdf',
      html: '<h1>A</h1>',
      paperWidthMm: 297,
      paperHeightMm: 210,
    });

    const files = [
      {
        path: '/tmp/a.pdf',
        html: '<h1>A</h1>',
        paperWidthMm: 180.5,
        paperHeightMm: 240.2,
      },
    ];
    await exportPdfFiles(files);
    expect(invokeMock).toHaveBeenLastCalledWith('write_pdf_files', { files });
  });
});
