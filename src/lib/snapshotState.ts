import type { AppSnapshot, EditorMode } from './desktop';

export function clearActiveDocumentSnapshot(snapshot: AppSnapshot): AppSnapshot {
  return {
    ...snapshot,
    activeDocumentName: null,
    activeDocumentPath: null,
    activeDocumentSource: null,
    activeDocumentDirty: false,
    lastError: null,
  };
}

export function setSnapshotMode(snapshot: AppSnapshot, mode: EditorMode): AppSnapshot {
  return { ...snapshot, mode };
}

export function setSnapshotLastError(
  snapshot: AppSnapshot,
  lastError: string | null,
): AppSnapshot {
  return { ...snapshot, lastError };
}

export function resolveSyncedDraftSnapshot(
  current: AppSnapshot,
  synced: AppSnapshot,
  activeDocumentPath: string | null,
): AppSnapshot {
  if (current.activeDocumentPath !== activeDocumentPath) {
    return current;
  }

  return { ...synced, mode: current.mode };
}
