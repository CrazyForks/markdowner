import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalAgentSettings } from './LocalAgentSettings';

afterEach(cleanup);

const statuses = [
  {
    kind: 'claude' as const,
    mention: '@claude' as const,
    label: 'Claude Code' as const,
    installed: true,
    compatible: true,
    pathLabel: 'claude (Homebrew)',
    version: '2.1.0',
    reason: null,
  },
  {
    kind: 'codex' as const,
    mention: '@codex' as const,
    label: 'Codex' as const,
    installed: true,
    compatible: false,
    pathLabel: 'codex (PATH)',
    version: '0.3.0',
    reason: 'This version is not supported.',
  },
  {
    kind: 'opencode' as const,
    mention: '@opencode' as const,
    label: 'OpenCode' as const,
    installed: false,
    compatible: false,
    pathLabel: null,
    version: null,
    reason: 'Not found.',
  },
];

describe('LocalAgentSettings', () => {
  it('applies the first status refresh after StrictMode replays its effect cleanup', async () => {
    const pending = deferred<typeof statuses>();
    const listStatuses = vi.fn().mockReturnValue(pending.promise);
    render(
      <StrictMode>
        <LocalAgentSettings
          disclosureAccepted={false}
          onDisclosureAcceptedChange={vi.fn()}
          services={{ listStatuses }}
        />
      </StrictMode>,
    );

    const button = screen.getByRole('button', { name: 'Refresh local agent status' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');

    await act(async () => pending.resolve(statuses));

    expect(screen.getByText('claude (Homebrew)')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it('lets the newest manual refresh win when an older response resolves last', async () => {
    const older = deferred<typeof statuses>();
    const newer = deferred<typeof statuses>();
    const latestStatuses = statuses.map((status) =>
      status.kind === 'claude' ? { ...status, version: '9.9.9' } : status,
    );
    const listStatuses = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    render(
      <LocalAgentSettings
        disclosureAccepted={false}
        onDisclosureAcceptedChange={vi.fn()}
        services={{ listStatuses }}
      />,
    );

    const button = screen.getByRole('button', { name: 'Refresh local agent status' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(listStatuses).toHaveBeenCalledTimes(2));

    await act(async () => newer.resolve(latestStatuses));
    expect(screen.getAllByTestId('local-agent-status-row')[0]).toHaveTextContent('Version 9.9.9');

    await act(async () => older.resolve(statuses));
    expect(screen.getAllByTestId('local-agent-status-row')[0]).toHaveTextContent('Version 9.9.9');
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it('does not update after an in-flight manual refresh unmounts', async () => {
    const pending = deferred<typeof statuses>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(
      <StrictMode>
        <LocalAgentSettings
          disclosureAccepted={false}
          onDisclosureAcceptedChange={vi.fn()}
          services={{ listStatuses: vi.fn().mockReturnValue(pending.promise) }}
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh local agent status' }));
    unmount();
    await act(async () => pending.resolve(statuses));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('refreshes fixed, redacted agent status rows and keeps local disclosure separate', async () => {
    const onDisclosureAcceptedChange = vi.fn();
    const listStatuses = vi.fn().mockResolvedValue(statuses);
    render(
      <LocalAgentSettings
        disclosureAccepted={false}
        onDisclosureAcceptedChange={onDisclosureAcceptedChange}
        services={{ listStatuses }}
      />,
    );

    expect(listStatuses).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('local-agent-status-row')).toHaveLength(3);
    expect(screen.getAllByTestId('local-agent-status-row').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Claude Code'),
      expect.stringContaining('Codex'),
      expect.stringContaining('OpenCode'),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh local agent status' }));
    await waitFor(() => expect(listStatuses).toHaveBeenCalledTimes(1));

    expect(screen.getAllByTestId('local-agent-status-row').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Claude Code'),
      expect.stringContaining('Codex'),
      expect.stringContaining('OpenCode'),
    ]);
    expect(screen.getByText('Compatible')).toBeInTheDocument();
    expect(screen.getByText('Incompatible')).toBeInTheDocument();
    expect(screen.getByText('Not installed')).toBeInTheDocument();
    expect(screen.getAllByTestId('local-agent-status-row')[0]).toHaveTextContent('Version 2.1.0');
    expect(screen.getByText('This version is not supported.')).toBeInTheDocument();
    expect(screen.getByText('claude (Homebrew)')).toBeInTheDocument();
    expect(screen.queryByText('/opt/homebrew/bin/claude')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Allow local agent processing' }));
    expect(onDisclosureAcceptedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText(/may contact its configured provider and consume quota/i)).toBeInTheDocument();
    expect(screen.getByText(/sends the current document snapshot without its file path/i)).toBeInTheDocument();
    expect(screen.getByText(/Markdowner does not store agent credentials or estimate provider cost/i)).toBeInTheDocument();
    expect(screen.getByText(/tools are disabled and Markdowner alone applies results/i)).toBeInTheDocument();
    expect(screen.getByText(/OpenCode may retain local session metadata/i)).toBeInTheDocument();
  });

  it('keeps rows usable without rendering sensitive status-refresh failure details', async () => {
    const unsafeFailure = new Error(
      'AcmeSensitiveProvider rejected sk-local-secret at /private/tmp/local-agent-token',
    );
    render(
      <LocalAgentSettings
        disclosureAccepted
        onDisclosureAcceptedChange={vi.fn()}
        services={{ listStatuses: vi.fn().mockRejectedValue(unsafeFailure) }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh local agent status' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not refresh local agent status.',
    );
    expect(alert).not.toHaveTextContent(/AcmeSensitiveProvider|sk-local-secret|private\/tmp/i);
    expect(screen.getAllByTestId('local-agent-status-row')).toHaveLength(3);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
