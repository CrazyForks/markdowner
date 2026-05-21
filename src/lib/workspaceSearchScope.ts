import type { DocumentTab } from './documentTabs';

type WorkspaceSearchScopeInput = {
  workspaceDocuments: readonly string[];
  tabs: readonly DocumentTab[];
};

export function buildWorkspaceSearchPaths(input: WorkspaceSearchScopeInput): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  const append = (path: string | null) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  };

  for (const path of input.workspaceDocuments) {
    append(path);
  }
  for (const tab of input.tabs) {
    append(tab.path);
  }

  return paths;
}
