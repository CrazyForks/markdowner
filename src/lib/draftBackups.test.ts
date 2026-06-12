import { describe, expect, it } from 'vitest';

import { createDocumentTab, createMissingDocumentTab, createSettingsTab } from './documentTabs';
import {
  applyDraftBackupsToRestoredTabs,
  buildDraftBackupEntries,
  normalizeDraftBackupEntries,
} from './draftBackups';

describe('buildDraftBackupEntries', () => {
  it('captures only dirty document tabs, reading the active tab from localDraft', () => {
    const dirtyActive = createDocumentTab({
      id: 'active',
      path: '/tmp/active.md',
      name: 'active.md',
      source: 'saved',
      draft: 'stale stash',
    });
    const dirtyInactive = createDocumentTab({
      id: 'inactive',
      path: '/tmp/inactive.md',
      name: 'inactive.md',
      source: 'saved',
      draft: 'edited offline',
    });
    const cleanTab = createDocumentTab({
      id: 'clean',
      path: '/tmp/clean.md',
      name: 'clean.md',
      source: 'same',
      draft: 'same',
    });

    expect(
      buildDraftBackupEntries({
        tabs: [dirtyActive, dirtyInactive, cleanTab],
        activeTabId: 'active',
        localDraft: 'live edits',
      }),
    ).toEqual([
      {
        path: '/tmp/active.md',
        untitledId: null,
        name: 'active.md',
        draft: 'live edits',
      },
      {
        path: '/tmp/inactive.md',
        untitledId: null,
        name: 'inactive.md',
        draft: 'edited offline',
      },
    ]);
  });

  it('keys untitled tabs by tab id', () => {
    const untitled = createDocumentTab({
      id: 'untitled-1',
      path: null,
      name: 'Untitled',
      source: '',
      draft: 'scratch note',
    });

    expect(
      buildDraftBackupEntries({
        tabs: [untitled],
        activeTabId: null,
        localDraft: '',
      }),
    ).toEqual([
      {
        path: null,
        untitledId: 'untitled-1',
        name: 'Untitled',
        draft: 'scratch note',
      },
    ]);
  });

  it('ignores settings tabs and drafts that only differ by the final newline', () => {
    const trailingNewlineOnly = createDocumentTab({
      id: 'newline',
      path: '/tmp/newline.md',
      name: 'newline.md',
      source: 'body\n',
      draft: 'body',
    });

    expect(
      buildDraftBackupEntries({
        tabs: [createSettingsTab(), trailingNewlineOnly],
        activeTabId: null,
        localDraft: '',
      }),
    ).toEqual([]);
  });
});

describe('applyDraftBackupsToRestoredTabs', () => {
  it('applies path-keyed drafts to matching restored tabs', () => {
    const restored = createDocumentTab({
      id: 'first',
      path: '/tmp/first.md',
      name: 'first.md',
      source: 'disk content',
    });

    const { tabs } = applyDraftBackupsToRestoredTabs({
      tabs: [restored],
      entries: [
        { path: '/tmp/first.md', untitledId: null, name: 'first.md', draft: 'unsaved edits' },
      ],
      createTabId: () => 'unused',
    });

    expect(tabs).toEqual([{ ...restored, draft: 'unsaved edits' }]);
  });

  it('drops backups whose draft matches the disk content', () => {
    const restored = createDocumentTab({
      id: 'first',
      path: '/tmp/first.md',
      name: 'first.md',
      source: 'disk content\n',
    });

    const { tabs } = applyDraftBackupsToRestoredTabs({
      tabs: [restored],
      entries: [
        { path: '/tmp/first.md', untitledId: null, name: 'first.md', draft: 'disk content' },
      ],
      createTabId: () => 'unused',
    });

    expect(tabs).toEqual([restored]);
  });

  it('skips missing tabs and backups for paths that are no longer open', () => {
    const missing = createMissingDocumentTab({
      id: 'gone',
      path: '/tmp/gone.md',
      name: 'gone.md',
    });

    const { tabs } = applyDraftBackupsToRestoredTabs({
      tabs: [missing],
      entries: [
        { path: '/tmp/gone.md', untitledId: null, name: 'gone.md', draft: 'orphaned' },
        { path: '/tmp/never-open.md', untitledId: null, name: 'x.md', draft: 'orphaned' },
      ],
      createTabId: () => 'unused',
    });

    expect(tabs).toEqual([missing]);
  });

  it('appends untitled backups as fresh untitled tabs', () => {
    const restored = createDocumentTab({
      id: 'first',
      path: '/tmp/first.md',
      name: 'first.md',
      source: 'disk content',
    });
    const ids = ['new-1', 'new-2'];

    const { tabs } = applyDraftBackupsToRestoredTabs({
      tabs: [restored],
      entries: [
        { path: null, untitledId: 'old-tab-id', name: 'Untitled', draft: 'scratch' },
        { path: null, untitledId: 'old-tab-id-2', name: null, draft: 'second scratch' },
        { path: null, untitledId: 'old-tab-id-3', name: 'Untitled', draft: '' },
      ],
      createTabId: () => ids.shift() ?? 'overflow',
    });

    expect(tabs).toEqual([
      restored,
      createDocumentTab({
        id: 'new-1',
        path: null,
        name: 'Untitled',
        source: '',
        draft: 'scratch',
      }),
      createDocumentTab({
        id: 'new-2',
        path: null,
        name: 'Untitled',
        source: '',
        draft: 'second scratch',
      }),
    ]);
  });
});

describe('normalizeDraftBackupEntries', () => {
  it('returns an empty list for non-array payloads', () => {
    expect(normalizeDraftBackupEntries(null)).toEqual([]);
    expect(normalizeDraftBackupEntries(undefined)).toEqual([]);
    expect(normalizeDraftBackupEntries({ entries: [] })).toEqual([]);
  });

  it('keeps well-formed entries and drops malformed ones', () => {
    expect(
      normalizeDraftBackupEntries([
        { path: '/tmp/a.md', untitledId: null, name: 'a.md', draft: 'text' },
        { path: null, untitledId: 'tab-1', draft: 'scratch' },
        { path: null, untitledId: null, name: 'no key', draft: 'dropped' },
        { path: '/tmp/b.md', untitledId: null, name: 'b.md', draft: 42 },
        'not an object',
      ]),
    ).toEqual([
      { path: '/tmp/a.md', untitledId: null, name: 'a.md', draft: 'text' },
      { path: null, untitledId: 'tab-1', name: null, draft: 'scratch' },
    ]);
  });
});
