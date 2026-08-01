import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiScopePicker } from './AiScopePicker';
import type { AiDocumentRef, AiRunScope } from './types';

afterEach(() => cleanup());

const current: AiDocumentRef = {
  documentId: 'doc-current',
  path: '/vault/product/PRD.md',
  label: 'product/PRD.md',
};
const other: AiDocumentRef = {
  documentId: 'doc-other',
  path: '/vault/research/notes.md',
  label: 'research/notes.md',
};

function renderPicker(value: AiRunScope, task: 'prd' | 'translation' | 'custom' = 'prd') {
  const onChange = vi.fn();
  render(
    <AiScopePicker
      value={value}
      task={task}
      currentDocument={current}
      openDocuments={[current, other]}
      workspaceRoot="/vault"
      workspaceFileCount={12}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('AiScopePicker', () => {
  it('starts on the current document and can target another open document', () => {
    const onChange = renderPicker({ kind: 'document', target: current });

    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('document');
    expect(screen.getByRole('combobox', { name: 'Document' })).toHaveValue('doc-current');
    expect(screen.getByRole('option', { name: 'research/notes.md' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Document' }), {
      target: { value: 'doc-other' },
    });
    expect(onChange).toHaveBeenCalledWith({ kind: 'document', target: other });
  });

  it('uses a target document for PRD workspace context', () => {
    const onChange = renderPicker({
      kind: 'workspace',
      rootPath: '/vault',
      target: current,
      documentCount: 12,
    });

    expect(screen.getByRole('combobox', { name: 'Target document' })).toHaveValue(
      'doc-current',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Target document' }), {
      target: { value: 'doc-other' },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'workspace',
      rootPath: '/vault',
      target: other,
      documentCount: 12,
    });
  });

  it('describes translation workspace scope as a sequential Markdown batch', () => {
    renderPicker(
      {
        kind: 'workspace',
        rootPath: '/vault',
        target: null,
        documentCount: 12,
      },
      'translation',
    );

    expect(screen.getByText(/Sequential Markdown batch · 12 files/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Target document' })).toBeNull();
  });

  it('disables workspace scope when no workspace root exists', () => {
    render(
      <AiScopePicker
        value={{ kind: 'document', target: current }}
        task="prd"
        currentDocument={current}
        openDocuments={[current]}
        workspaceRoot={null}
        workspaceFileCount={0}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: /Workspace/i })).toBeDisabled();
  });
});
