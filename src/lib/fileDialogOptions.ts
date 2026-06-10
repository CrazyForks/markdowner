export const MARKDOWN_FILE_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];

type OpenDialogSelection = string | string[] | null | undefined;

type OpenDialogDefaultPathInput = {
  activeDocumentPath?: string | null;
  rootDir?: string | null;
  recentDocuments?: readonly string[] | null;
};

export function normalizeOpenDialogPaths(selection: OpenDialogSelection): string[] {
  if (selection === null || selection === undefined) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

export function defaultMarkdownSavePath(
  activeDocumentPath: string | null | undefined,
  activeDocumentName: string | null | undefined,
): string {
  return activeDocumentPath ?? activeDocumentName ?? 'Untitled.md';
}

function parentDirectory(path: string | null | undefined): string | undefined {
  if (!path) return undefined;

  const normalized = path.replace(/[\\/]+$/, '');
  if (!normalized) return undefined;

  const slashIndex = normalized.lastIndexOf('/');
  const backslashIndex = normalized.lastIndexOf('\\');
  const separatorIndex = Math.max(slashIndex, backslashIndex);
  if (separatorIndex < 0) return undefined;
  if (separatorIndex === 0) return normalized.slice(0, 1);
  if (separatorIndex === 2 && /^[A-Za-z]:/.test(normalized)) {
    return `${normalized.slice(0, 2)}\\`;
  }

  return normalized.slice(0, separatorIndex);
}

function firstRecentDocumentDirectory(
  recentDocuments: readonly string[] | null | undefined,
): string | undefined {
  for (const path of recentDocuments ?? []) {
    const directory = parentDirectory(path);
    if (directory) return directory;
  }
  return undefined;
}

export function defaultOpenDocumentDialogPath(input: OpenDialogDefaultPathInput): string | undefined {
  return (
    parentDirectory(input.activeDocumentPath) ??
    firstRecentDocumentDirectory(input.recentDocuments) ??
    input.rootDir ??
    undefined
  );
}

export function defaultOpenWorkspaceDialogPath(input: OpenDialogDefaultPathInput): string | undefined {
  return (
    input.rootDir ??
    parentDirectory(input.activeDocumentPath) ??
    firstRecentDocumentDirectory(input.recentDocuments) ??
    undefined
  );
}
