import { displayFileName, displayWorkspacePath } from './workspaceTree';

export type QuickOpenItemKind = 'workspace' | 'recent';

export type QuickOpenFileItem = {
  path: string;
  name: string;
  relativePath: string;
  kind: QuickOpenItemKind;
};

type QuickOpenSnapshot = {
  workspaceDocuments: readonly string[];
  recentDocuments: readonly string[];
  rootDir: string | null;
};

export type QuickOpenViewState = {
  items: QuickOpenFileItem[];
  workspacePathSet: ReadonlySet<string>;
  signature: string;
};

export function buildQuickOpenItems(snapshot: QuickOpenSnapshot): QuickOpenFileItem[] {
  const seen = new Set<string>();
  const items: QuickOpenFileItem[] = [];

  const accumulate = (paths: readonly string[], kind: QuickOpenItemKind) => {
    for (const path of paths) {
      if (!path || seen.has(path)) continue;
      seen.add(path);
      items.push({
        path,
        name: displayFileName(path),
        relativePath: displayWorkspacePath(path, snapshot.rootDir),
        kind,
      });
    }
  };

  accumulate(snapshot.workspaceDocuments, 'workspace');
  accumulate(snapshot.recentDocuments, 'recent');
  return items;
}

export function buildQuickOpenSignature(snapshot: QuickOpenSnapshot): string {
  return [
    snapshot.rootDir ?? '',
    'workspace',
    ...snapshot.workspaceDocuments,
    'recent',
    ...snapshot.recentDocuments,
  ].join('\u0000');
}

export function resolveQuickOpenViewState(snapshot: QuickOpenSnapshot): QuickOpenViewState {
  return {
    items: buildQuickOpenItems(snapshot),
    workspacePathSet: new Set(snapshot.workspaceDocuments.filter(Boolean)),
    signature: buildQuickOpenSignature(snapshot),
  };
}

export function resolveQuickOpenSelectionKind(
  path: string,
  workspacePathSet: ReadonlySet<string>,
): QuickOpenItemKind {
  return workspacePathSet.has(path) ? 'workspace' : 'recent';
}
