import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_FILE_EXTENSIONS,
  defaultOpenDocumentDialogPath,
  defaultOpenWorkspaceDialogPath,
  defaultMarkdownSavePath,
  normalizeOpenDialogPaths,
} from './fileDialogOptions';

describe('file dialog options', () => {
  it('normalizes open dialog selections to path arrays', () => {
    expect(normalizeOpenDialogPaths(null)).toEqual([]);
    expect(normalizeOpenDialogPaths(undefined)).toEqual([]);
    expect(normalizeOpenDialogPaths('/tmp/project/a.md')).toEqual(['/tmp/project/a.md']);
    expect(normalizeOpenDialogPaths(['/tmp/project/a.md', '/tmp/project/b.md'])).toEqual([
      '/tmp/project/a.md',
      '/tmp/project/b.md',
    ]);
    expect(normalizeOpenDialogPaths([])).toEqual([]);
  });

  it('uses the saved path, document name, then untitled fallback for markdown saves', () => {
    expect(defaultMarkdownSavePath('/tmp/project/a.md', 'a.md')).toBe('/tmp/project/a.md');
    expect(defaultMarkdownSavePath(null, 'draft.md')).toBe('draft.md');
    expect(defaultMarkdownSavePath(null, null)).toBe('Untitled.md');
  });

  it('opens document dialogs at the most recent document directory before the workspace root', () => {
    expect(
      defaultOpenDocumentDialogPath({
        rootDir: '/tmp/project',
        recentDocuments: ['/tmp/project/docs/recent.md'],
      }),
    ).toBe('/tmp/project/docs');
    expect(
      defaultOpenDocumentDialogPath({
        rootDir: '/tmp/project',
        recentDocuments: [],
      }),
    ).toBe('/tmp/project');
  });

  it('opens workspace dialogs at the workspace root before the most recent document directory', () => {
    expect(
      defaultOpenWorkspaceDialogPath({
        rootDir: '/tmp/project',
        recentDocuments: ['/tmp/project/docs/recent.md'],
      }),
    ).toBe('/tmp/project');
    expect(
      defaultOpenWorkspaceDialogPath({
        rootDir: null,
        recentDocuments: ['/tmp/project/docs/recent.md'],
      }),
    ).toBe('/tmp/project/docs');
  });

  it('derives dialog defaults from Windows-style recent document paths', () => {
    expect(
      defaultOpenDocumentDialogPath({
        rootDir: null,
        recentDocuments: ['C:\\Users\\chann\\workspace\\guides\\draft.md'],
      }),
    ).toBe('C:\\Users\\chann\\workspace\\guides');
  });

  it('keeps the supported markdown extensions in one reusable list', () => {
    expect(MARKDOWN_FILE_EXTENSIONS).toEqual(['md', 'markdown', 'mdown', 'mkd']);
  });
});
