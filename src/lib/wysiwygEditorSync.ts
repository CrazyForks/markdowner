export type WysiwygContentSyncAction =
  | { kind: 'skip' }
  | {
      kind: 'sync';
      tabChanged: boolean;
      shouldClearDomSelection: boolean;
      shouldFinalizeComposition: boolean;
    };

export function resolveWysiwygContentSyncAction({
  activeTabId,
  lastSyncedTabId,
  localDraft,
  lastEditorMarkdown,
  isComposing,
  viewComposing,
}: {
  activeTabId: string | null;
  lastSyncedTabId: string | null;
  localDraft: string;
  lastEditorMarkdown: string;
  isComposing: boolean;
  viewComposing: boolean | undefined;
}): WysiwygContentSyncAction {
  const tabChanged = activeTabId !== lastSyncedTabId;
  const composing = isComposing || Boolean(viewComposing);

  if (!tabChanged && localDraft === lastEditorMarkdown) {
    return { kind: 'skip' };
  }

  if (!tabChanged && composing) {
    return { kind: 'skip' };
  }

  return {
    kind: 'sync',
    tabChanged,
    shouldClearDomSelection: tabChanged,
    shouldFinalizeComposition: tabChanged && composing,
  };
}
