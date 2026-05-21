import type { OpenTabsPayload } from './desktop';
import type { DocumentTab } from './documentTabs';
import type { SourceCursorLocation } from './modeCursor';

type BuildOpenTabsPayloadInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  cursorPositions: ReadonlyMap<string, SourceCursorLocation>;
};

type LoadOpenTabsWithEmptyRetryInput = {
  load: () => Promise<OpenTabsPayload>;
  waitForRetry: () => Promise<void>;
  shouldAbort?: () => boolean;
};

type LoadOpenTabsWithEmptyRetryResult =
  | { kind: 'ready'; payload: OpenTabsPayload }
  | { kind: 'aborted' };

export function buildOpenTabsPayload(
  input: BuildOpenTabsPayloadInput,
): OpenTabsPayload {
  const openTabs = input.tabs
    .filter((tab): tab is DocumentTab & { kind: 'document'; path: string } => {
      return tab.kind === 'document' && tab.path !== null;
    })
    .map((tab) => tab.path);
  const openTabSet = new Set(openTabs);
  const activeTabPath =
    input.activeTabId === null
      ? null
      : input.tabs.find(
          (tab) =>
            tab.id === input.activeTabId &&
            tab.kind === 'document' &&
            tab.path !== null,
        )?.path ?? null;
  const cursorPositions: OpenTabsPayload['cursorPositions'] = {};

  for (const [path, location] of input.cursorPositions.entries()) {
    if (!openTabSet.has(path)) continue;
    cursorPositions[path] = {
      line: location.line,
      column: location.column,
    };
  }

  return {
    openTabs,
    activeTabPath,
    cursorPositions,
  };
}

export function cursorPositionsMapFromOpenTabsPayload(
  payload: OpenTabsPayload,
): Map<string, SourceCursorLocation> {
  return new Map(Object.entries(payload.cursorPositions));
}

export async function loadOpenTabsWithEmptyRetry(
  input: LoadOpenTabsWithEmptyRetryInput,
): Promise<LoadOpenTabsWithEmptyRetryResult> {
  const first = await input.load();
  if (input.shouldAbort?.()) {
    return { kind: 'aborted' };
  }

  if (first.openTabs.length > 0) {
    return { kind: 'ready', payload: first };
  }

  await input.waitForRetry();
  if (input.shouldAbort?.()) {
    return { kind: 'aborted' };
  }

  const retried = await input.load();
  if (input.shouldAbort?.()) {
    return { kind: 'aborted' };
  }

  return {
    kind: 'ready',
    payload: retried.openTabs.length > 0 ? retried : first,
  };
}
