import { describe, expect, it } from 'vitest';

import { resolveWysiwygContentSyncAction } from './wysiwygEditorSync';

describe('resolveWysiwygContentSyncAction', () => {
  it('skips editor-authored updates on the same tab to avoid redundant setContent', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-1',
        lastSyncedTabId: 'doc-1',
        localDraft: '# Draft',
        lastEditorMarkdown: '# Draft',
        isComposing: false,
        viewComposing: false,
      }),
    ).toEqual({
      kind: 'skip',
    });
  });

  it('defers same-tab external updates while IME composition is active', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-1',
        lastSyncedTabId: 'doc-1',
        localDraft: '# External',
        lastEditorMarkdown: '# Editor',
        isComposing: true,
        viewComposing: false,
      }),
    ).toEqual({
      kind: 'skip',
    });
  });

  it('syncs tab changes even when markdown matches and requests composition finalization when needed', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-2',
        lastSyncedTabId: 'doc-1',
        localDraft: '',
        lastEditorMarkdown: '',
        isComposing: false,
        viewComposing: true,
      }),
    ).toEqual({
      kind: 'sync',
      tabChanged: true,
      shouldClearDomSelection: true,
      shouldFinalizeComposition: true,
    });
  });

  it('syncs external draft changes on the same tab without clearing DOM selection', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-1',
        lastSyncedTabId: 'doc-1',
        localDraft: '# External',
        lastEditorMarkdown: '# Editor',
        isComposing: false,
        viewComposing: false,
      }),
    ).toEqual({
      kind: 'sync',
      tabChanged: false,
      shouldClearDomSelection: false,
      shouldFinalizeComposition: false,
    });
  });
});
