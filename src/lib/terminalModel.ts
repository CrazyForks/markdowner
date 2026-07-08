type TerminalWorkingDirectoryInput = {
  configuredPath: string;
  workspaceRoot: string | null;
  activeDocumentPath: string | null;
};

export function resolveTerminalWorkingDirectory({
  configuredPath,
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
  return activeDocumentDirectory ?? workspaceRoot ?? null;
}

function directoryName(path: string): string | null {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : null;
}
