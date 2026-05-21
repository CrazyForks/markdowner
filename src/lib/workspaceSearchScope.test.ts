import { describe, expect, it } from 'vitest';

import { createDocumentTab, createSettingsTab } from './documentTabs';
import { buildWorkspaceSearchPaths } from './workspaceSearchScope';

describe('buildWorkspaceSearchPaths', () => {
  it('combines workspace documents and open document tabs without duplicates', () => {
    expect(
      buildWorkspaceSearchPaths({
        workspaceDocuments: [
          '/tmp/project/README.md',
          '',
          '/tmp/project/docs/guide.md',
        ],
        tabs: [
          createDocumentTab({
            id: 'readme',
            path: '/tmp/project/README.md',
            name: 'README.md',
          }),
          createDocumentTab({
            id: 'external',
            path: '/tmp/external/notes.md',
            name: 'notes.md',
          }),
          createSettingsTab(),
        ],
      }),
    ).toEqual([
      '/tmp/project/README.md',
      '/tmp/project/docs/guide.md',
      '/tmp/external/notes.md',
    ]);
  });

  it('ignores untitled and missing path tabs', () => {
    expect(
      buildWorkspaceSearchPaths({
        workspaceDocuments: [],
        tabs: [
          createDocumentTab({
            id: 'untitled',
            path: null,
            name: 'Untitled',
          }),
          createSettingsTab(),
        ],
      }),
    ).toEqual([]);
  });
});
