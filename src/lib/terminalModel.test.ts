import { describe, expect, it } from 'vitest';

import { resolveTerminalWorkingDirectory } from './terminalModel';

describe('resolveTerminalWorkingDirectory', () => {
  it('prefers the configured terminal default path', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '  /tmp/configured  ',
        workspaceRoot: '/tmp/workspace',
        activeDocumentPath: '/tmp/workspace/notes.md',
      }),
    ).toBe('/tmp/configured');
  });

  it('uses the active document folder before the workspace root', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        workspaceRoot: '/tmp/workspace',
        activeDocumentPath: '/tmp/workspace/docs/notes.md',
      }),
    ).toBe('/tmp/workspace/docs');
  });

  it('falls back to the workspace root when no terminal path or active document path exists', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        workspaceRoot: '/tmp/workspace',
        activeDocumentPath: null,
      }),
    ).toBe('/tmp/workspace');
  });

  it('uses the active document folder when no workspace is open', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        workspaceRoot: null,
        activeDocumentPath: '/tmp/workspace/docs/notes.md',
      }),
    ).toBe('/tmp/workspace/docs');
  });

  it('returns null when no local path context exists', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        workspaceRoot: null,
        activeDocumentPath: null,
      }),
    ).toBeNull();
  });
});
