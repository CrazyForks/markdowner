import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installDiagnosticsLogging,
  sanitizeDiagnosticsConsoleLabel,
} from './diagnosticsLogging';

const recordDiagnosticsEventMock = vi.hoisted(() => vi.fn());
const originalConsole = {
  debug: console.debug,
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn,
};

vi.mock('./settings', () => ({
  recordDiagnosticsEvent: recordDiagnosticsEventMock,
}));

describe('diagnostics logging bridge', () => {
  afterEach(() => {
    recordDiagnosticsEventMock.mockReset();
    console.debug = originalConsole.debug;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  });

  it('redacts paths, urls, and multiline content from console labels', () => {
    expect(
      sanitizeDiagnosticsConsoleLabel(
        'Failed to open /Users/channprj/private/notes.md at https://example.com/private?q=1',
      ),
    ).toBe('Failed to open [path] at [url]');
    expect(sanitizeDiagnosticsConsoleLabel('first line\nprivate document body')).toBe(
      '[multiline]',
    );
  });

  it('mirrors console logs as metadata without forwarding argument contents', () => {
    const warnSpy = vi.fn();
    console.warn = warnSpy;
    installDiagnosticsLogging();

    console.warn('Failed to save /Users/channprj/private/notes.md', {
      source: '# private note',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to save /Users/channprj/private/notes.md',
      { source: '# private note' },
    );
    expect(recordDiagnosticsEventMock).toHaveBeenCalledWith('frontend.console', {
      level: 'warn',
      label: 'Failed to save [path]',
      argumentCount: 2,
      argumentTypes: ['string', 'object'],
    });
    expect(JSON.stringify(recordDiagnosticsEventMock.mock.calls)).not.toContain(
      'private note',
    );
    expect(JSON.stringify(recordDiagnosticsEventMock.mock.calls)).not.toContain(
      '/Users/channprj/private/notes.md',
    );
  });
});
