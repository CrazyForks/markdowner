import {
  createDocumentTab,
  isDocumentTabDirty,
  type DocumentTab,
} from './documentTabs';
import { normalizeFinalNewline } from './sourceText';

/**
 * One unsaved buffer captured for hot exit. `path` identifies file-backed
 * tabs; `untitledId` (the originating tab id) identifies untitled buffers.
 * Mirrors `DraftBackupEntry` in markdowner-core's storage.rs.
 */
export type DraftBackupEntry = {
  path: string | null;
  untitledId: string | null;
  name: string | null;
  draft: string;
};

type BuildDraftBackupEntriesInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  localDraft: string;
};

type ApplyDraftBackupsToRestoredTabsInput = {
  tabs: readonly DocumentTab[];
  entries: readonly DraftBackupEntry[];
  createTabId: () => string;
};

type ApplyDraftBackupsToRestoredTabsResult = {
  tabs: DocumentTab[];
};

/**
 * Snapshot every dirty document tab into backup entries. Rebuilt wholesale
 * from the live tab state on each write, so any flow that closes or saves a
 * tab (including the explicit "Don't Save" discard) drops its entry on the
 * next persist — a discarded draft can never be restored.
 */
export function buildDraftBackupEntries(
  input: BuildDraftBackupEntriesInput,
): DraftBackupEntry[] {
  const dirtyContext = {
    activeTabId: input.activeTabId,
    localDraft: input.localDraft,
  };

  return input.tabs
    .filter((tab) => isDocumentTabDirty(tab, dirtyContext))
    .map((tab) => ({
      path: tab.path,
      untitledId: tab.path === null ? tab.id : null,
      name: tab.name,
      draft: tab.id === input.activeTabId ? input.localDraft : tab.draft,
    }));
}

/**
 * Re-attach backed-up drafts to the tabs restored from the session file and
 * recreate untitled buffers as fresh tabs. Backups that match the disk
 * content (saved externally, or never actually divergent) are dropped as
 * clean; backups for paths that are no longer open are ignored.
 */
export function applyDraftBackupsToRestoredTabs(
  input: ApplyDraftBackupsToRestoredTabsInput,
): ApplyDraftBackupsToRestoredTabsResult {
  const draftByPath = new Map<string, string>();
  const untitledEntries: DraftBackupEntry[] = [];

  for (const entry of input.entries) {
    if (entry.path !== null) {
      draftByPath.set(entry.path, entry.draft);
    } else if (
      entry.untitledId !== null &&
      normalizeFinalNewline(entry.draft) !== normalizeFinalNewline('')
    ) {
      untitledEntries.push(entry);
    }
  }

  const tabs = input.tabs.map((tab) => {
    if (tab.kind !== 'document' || tab.missing || tab.path === null) {
      return tab;
    }
    const draft = draftByPath.get(tab.path);
    if (
      draft === undefined ||
      normalizeFinalNewline(draft) === normalizeFinalNewline(tab.source)
    ) {
      return tab;
    }
    return { ...tab, draft };
  });

  const restoredUntitled = untitledEntries.map((entry) =>
    createDocumentTab({
      id: input.createTabId(),
      path: null,
      name: entry.name ?? 'Untitled',
      source: '',
      draft: entry.draft,
    }),
  );

  return { tabs: [...tabs, ...restoredUntitled] };
}

/** Guard the wire payload from `load_draft_backups` (older files, partial mocks). */
export function normalizeDraftBackupEntries(value: unknown): DraftBackupEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: DraftBackupEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as {
      path?: unknown;
      untitledId?: unknown;
      name?: unknown;
      draft?: unknown;
    };
    if (typeof candidate.draft !== 'string') continue;
    const path = typeof candidate.path === 'string' ? candidate.path : null;
    const untitledId =
      typeof candidate.untitledId === 'string' ? candidate.untitledId : null;
    if (path === null && untitledId === null) continue;
    entries.push({
      path,
      untitledId,
      name: typeof candidate.name === 'string' ? candidate.name : null,
      draft: candidate.draft,
    });
  }
  return entries;
}
