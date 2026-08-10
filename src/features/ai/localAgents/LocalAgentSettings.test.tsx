import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText(/OpenCode may retain local session metadata/i)).toBeInTheDocument();
  });

  it('keeps rows usable when status refresh fails', async () => {
    render(
      <LocalAgentSettings
        disclosureAccepted
        onDisclosureAcceptedChange={vi.fn()}
        services={{ listStatuses: vi.fn().mockRejectedValue(new Error('Unavailable')) }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh local agent status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.getAllByTestId('local-agent-status-row')).toHaveLength(3);
  });
});
