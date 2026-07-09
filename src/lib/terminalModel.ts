export type TerminalStartLocation = 'document' | 'workspace';

type TerminalWorkingDirectoryInput = {
  configuredPath: string;
  startLocation: TerminalStartLocation;
  workspaceRoot: string | null;
  activeDocumentPath: string | null;
};

export function resolveTerminalWorkingDirectory({
  configuredPath,
  startLocation,
  workspaceRoot,
  activeDocumentPath,
}: TerminalWorkingDirectoryInput): string | null {
  const configured = configuredPath.trim();
  if (configured.length > 0) {
    return configured;
  }
  const activeDocumentDirectory = activeDocumentPath
    ? directoryName(activeDocumentPath)
    : null;
  if (startLocation === 'workspace') {
    return workspaceRoot ?? activeDocumentDirectory ?? null;
  }
  return activeDocumentDirectory ?? workspaceRoot ?? null;
}

function directoryName(path: string): string | null {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : null;
}
