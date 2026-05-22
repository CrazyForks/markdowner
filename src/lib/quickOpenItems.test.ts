import { describe, expect, it } from 'vitest';

import {
  buildQuickOpenItems,
  buildQuickOpenSignature,
  resolveQuickOpenSelectionKind,
  resolveQuickOpenViewState,
} from './quickOpenItems';

describe('buildQuickOpenItems', () => {
  it('builds workspace items before recent items with display metadata', () => {
    expect(
      buildQuickOpenItems(
        {
          workspaceDocuments: [
            '/tmp/project/README.md',
            '/tmp/project/docs/guide.md',
          ],
          recentDocuments: ['/tmp/other/notes.md'],
          rootDir: '/tmp/project',
        },
      ),
    ).toEqual([
      {
        path: '/tmp/project/README.md',
        name: 'README.md',
        relativePath: 'README.md',
        kind: 'workspace',
      },
      {
        path: '/tmp/project/docs/guide.md',
        name: 'guide.md',
        relativePath: 'docs/guide.md',
        kind: 'workspace',
      },
      {
        path: '/tmp/other/notes.md',
        name: 'notes.md',
        relativePath: '/tmp/other/notes.md',
        kind: 'recent',
      },
    ]);
  });

  it('deduplicates blank and repeated paths while preserving the first source kind', () => {
    expect(
      buildQuickOpenItems({
        workspaceDocuments: ['/tmp/project/README.md', '', '/tmp/project/README.md'],
        recentDocuments: ['/tmp/project/README.md', '/tmp/project/notes.md'],
        rootDir: '/tmp/project',
      }),
    ).toEqual([
      {
        path: '/tmp/project/README.md',
        name: 'README.md',
        relativePath: 'README.md',
        kind: 'workspace',
      },
      {
        path: '/tmp/project/notes.md',
        name: 'notes.md',
        relativePath: 'notes.md',
        kind: 'recent',
      },
    ]);
  });
});

describe('buildQuickOpenSignature', () => {
  it('captures root, workspace, and recent paths for memo dependencies', () => {
    expect(
      buildQuickOpenSignature({
        workspaceDocuments: ['/tmp/project/README.md'],
        recentDocuments: ['/tmp/other/notes.md'],
        rootDir: '/tmp/project',
      }),
    ).toBe(
      '/tmp/project\u0000workspace\u0000/tmp/project/README.md\u0000recent\u0000/tmp/other/notes.md',
    );
  });
});

describe('resolveQuickOpenViewState', () => {
  it('builds items with a workspace lookup for efficient selection routing', () => {
    const state = resolveQuickOpenViewState({
      workspaceDocuments: ['/tmp/project/README.md', '/tmp/project/docs/guide.md'],
      recentDocuments: ['/tmp/project/README.md', '/tmp/other/notes.md'],
      rootDir: '/tmp/project',
    });

    expect(state.items.map((item) => [item.path, item.kind])).toEqual([
      ['/tmp/project/README.md', 'workspace'],
      ['/tmp/project/docs/guide.md', 'workspace'],
      ['/tmp/other/notes.md', 'recent'],
    ]);
    expect(state.workspacePathSet).toEqual(
      new Set(['/tmp/project/README.md', '/tmp/project/docs/guide.md']),
    );
    expect(state.signature).toBe(
      '/tmp/project\u0000workspace\u0000/tmp/project/README.md\u0000/tmp/project/docs/guide.md\u0000recent\u0000/tmp/project/README.md\u0000/tmp/other/notes.md',
    );
  });
});

describe('resolveQuickOpenSelectionKind', () => {
  it('routes selected paths by workspace membership', () => {
    const workspacePathSet = new Set(['/tmp/project/README.md']);

    expect(resolveQuickOpenSelectionKind('/tmp/project/README.md', workspacePathSet)).toBe(
      'workspace',
    );
    expect(resolveQuickOpenSelectionKind('/tmp/other/notes.md', workspacePathSet)).toBe(
      'recent',
    );
  });
});
