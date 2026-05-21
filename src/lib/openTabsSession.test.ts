import { describe, expect, it } from 'vitest';

import { createDocumentTab, createSettingsTab } from './documentTabs';
import {
  buildOpenTabsPayload,
  cursorPositionsMapFromOpenTabsPayload,
  loadOpenTabsWithEmptyRetry,
} from './openTabsSession';

describe('buildOpenTabsPayload', () => {
  it('persists only path-backed document tabs and the active document path', () => {
    const savedFirst = createDocumentTab({
      id: 'first',
      path: '/tmp/first.md',
      name: 'first.md',
    });
    const untitled = createDocumentTab({
      id: 'untitled',
      path: null,
      name: 'Untitled',
    });
    const savedSecond = createDocumentTab({
      id: 'second',
      path: '/tmp/second.md',
      name: 'second.md',
    });

    expect(
      buildOpenTabsPayload({
        tabs: [savedFirst, createSettingsTab(), untitled, savedSecond],
        activeTabId: 'second',
        cursorPositions: new Map([
          ['/tmp/first.md', { line: 2, column: 3 }],
          ['/tmp/closed.md', { line: 10, column: 1 }],
          ['/tmp/second.md', { line: 4, column: 5 }],
        ]),
      }),
    ).toEqual({
      openTabs: ['/tmp/first.md', '/tmp/second.md'],
      activeTabPath: '/tmp/second.md',
      cursorPositions: {
        '/tmp/first.md': { line: 2, column: 3 },
        '/tmp/second.md': { line: 4, column: 5 },
      },
    });
  });

  it('uses a null active path when the active tab is not a persisted document', () => {
    const saved = createDocumentTab({
      id: 'saved',
      path: '/tmp/saved.md',
      name: 'saved.md',
    });

    expect(
      buildOpenTabsPayload({
        tabs: [saved, createSettingsTab()],
        activeTabId: '__markdowner_settings__',
        cursorPositions: new Map([['/tmp/saved.md', { line: 1, column: 1 }]]),
      }),
    ).toEqual({
      openTabs: ['/tmp/saved.md'],
      activeTabPath: null,
      cursorPositions: {
        '/tmp/saved.md': { line: 1, column: 1 },
      },
    });
  });
});

describe('cursorPositionsMapFromOpenTabsPayload', () => {
  it('returns a cursor-position map from persisted open-tabs payloads', () => {
    const map = cursorPositionsMapFromOpenTabsPayload({
      openTabs: ['/tmp/first.md', '/tmp/second.md'],
      activeTabPath: '/tmp/second.md',
      cursorPositions: {
        '/tmp/first.md': { line: 2, column: 3 },
        '/tmp/second.md': { line: 4, column: 5 },
      },
    });

    expect(map).toBeInstanceOf(Map);
    expect([...map.entries()]).toEqual([
      ['/tmp/first.md', { line: 2, column: 3 }],
      ['/tmp/second.md', { line: 4, column: 5 }],
    ]);
  });

  it('returns an independent map so callers can update cursor state safely', () => {
    const payload = {
      openTabs: ['/tmp/first.md'],
      activeTabPath: '/tmp/first.md',
      cursorPositions: {
        '/tmp/first.md': { line: 2, column: 3 },
      },
    };

    const map = cursorPositionsMapFromOpenTabsPayload(payload);
    map.set('/tmp/other.md', { line: 1, column: 1 });

    expect(Object.keys(payload.cursorPositions)).toEqual(['/tmp/first.md']);
  });
});

describe('loadOpenTabsWithEmptyRetry', () => {
  const emptyPayload = {
    openTabs: [],
    activeTabPath: null,
    cursorPositions: {},
  };

  it('returns the first payload without waiting when tabs are present', async () => {
    let loadCount = 0;
    let waitCount = 0;
    const first = {
      openTabs: ['/tmp/first.md'],
      activeTabPath: '/tmp/first.md',
      cursorPositions: {
        '/tmp/first.md': { line: 2, column: 3 },
      },
    };

    await expect(
      loadOpenTabsWithEmptyRetry({
        load: async () => {
          loadCount += 1;
          return first;
        },
        waitForRetry: async () => {
          waitCount += 1;
        },
      }),
    ).resolves.toEqual({ kind: 'ready', payload: first });
    expect(loadCount).toBe(1);
    expect(waitCount).toBe(0);
  });

  it('waits and uses the retried payload when the first read is empty', async () => {
    const retried = {
      openTabs: ['/tmp/restored.md'],
      activeTabPath: '/tmp/restored.md',
      cursorPositions: {
        '/tmp/restored.md': { line: 4, column: 5 },
      },
    };
    const reads = [emptyPayload, retried];
    let waitCount = 0;

    await expect(
      loadOpenTabsWithEmptyRetry({
        load: async () => reads.shift() ?? emptyPayload,
        waitForRetry: async () => {
          waitCount += 1;
        },
      }),
    ).resolves.toEqual({ kind: 'ready', payload: retried });
    expect(waitCount).toBe(1);
  });

  it('keeps the first payload when the retried read is still empty', async () => {
    const first = {
      openTabs: [],
      activeTabPath: null,
      cursorPositions: {
        '/tmp/recent.md': { line: 6, column: 7 },
      },
    };
    const second = {
      openTabs: [],
      activeTabPath: null,
      cursorPositions: {
        '/tmp/other.md': { line: 1, column: 1 },
      },
    };
    const reads = [first, second];

    await expect(
      loadOpenTabsWithEmptyRetry({
        load: async () => reads.shift() ?? emptyPayload,
        waitForRetry: async () => undefined,
      }),
    ).resolves.toEqual({ kind: 'ready', payload: first });
  });

  it('aborts after the first read when cancellation is requested', async () => {
    let cancelled = false;

    const result = await loadOpenTabsWithEmptyRetry({
      load: async () => {
        cancelled = true;
        return emptyPayload;
      },
      waitForRetry: async () => {
        throw new Error('should not wait after abort');
      },
      shouldAbort: () => cancelled,
    });

    expect(result).toEqual({ kind: 'aborted' });
  });

  it('aborts after the retry wait before reading again', async () => {
    let cancelled = false;
    let loadCount = 0;

    const result = await loadOpenTabsWithEmptyRetry({
      load: async () => {
        loadCount += 1;
        return emptyPayload;
      },
      waitForRetry: async () => {
        cancelled = true;
      },
      shouldAbort: () => cancelled,
    });

    expect(result).toEqual({ kind: 'aborted' });
    expect(loadCount).toBe(1);
  });
});
