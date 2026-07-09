import { describe, expect, it } from 'vitest';

import { resolveTerminalWorkingDirectory } from './terminalModel';

describe('resolveTerminalWorkingDirectory', () => {
  it('prefers the configured terminal default path', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '  /tmp/configured  ',
        startLocation: 'workspace',
        workspaceRoot: '/tmp/workspace',
        activeDocumentPath: '/tmp/workspace/notes.md',
      }),
    ).toBe('/tmp/configured');
  });

  it('uses the active document folder before the workspace root', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        startLocation: 'document',
        workspaceRoot: '/tmp/workspace',
        activeDocumentPath: '/tmp/workspace/docs/notes.md',
      }),
    ).toBe('/tmp/workspace/docs');
  });

  it('uses the workspace root before the active document folder when configured', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        startLocation: 'workspace',
        workspaceRoot: '/tmp/workspace',
        activeDocumentPath: '/tmp/workspace/docs/notes.md',
      }),
    ).toBe('/tmp/workspace');
  });

  it('falls back to the workspace root when no terminal path or active document path exists', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        startLocation: 'document',
        workspaceRoot: '/tmp/workspace',
        activeDocumentPath: null,
      }),
    ).toBe('/tmp/workspace');
  });

  it('uses the active document folder when no workspace is open', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        startLocation: 'workspace',
        workspaceRoot: null,
        activeDocumentPath: '/tmp/workspace/docs/notes.md',
      }),
    ).toBe('/tmp/workspace/docs');
  });

  it('returns null when no local path context exists', () => {
    expect(
      resolveTerminalWorkingDirectory({
        configuredPath: '',
        startLocation: 'document',
        workspaceRoot: null,
        activeDocumentPath: null,
      }),
    ).toBeNull();
  });
});
