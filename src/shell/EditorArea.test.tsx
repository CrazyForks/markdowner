import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorArea } from './EditorArea';

const baseProps = {
  busy: false,
  errorMessage: null,
  externalChangeMessage: null,
  showExternalChangeActions: false,
  externalCompareSource: null,
  activeDocumentOpen: true,
  onReloadActiveDocument: () => {},
  onKeepLocalChanges: () => {},
  onCompareExternalChanges: () => {},
  onHideComparison: () => {},
  localDraft: 'hi',
  activeDocumentName: 'a.md',
  editorContent: <div data-testid="wysiwyg-marker" />,
  sourceEditor: <div data-testid="source-marker" />,
  splitViewPreview: <div data-testid="preview-marker" />,
} as const;

describe('EditorArea mode switch', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(['Editor', 'Wysiwyg', 'SplitView'] as const)(
    'mounts source, wysiwyg, and preview markers in mode %s',
    (mode) => {
      render(<EditorArea {...baseProps} currentMode={mode} />);
      expect(screen.getByTestId('source-marker')).toBeInTheDocument();
      expect(screen.getByTestId('wysiwyg-marker')).toBeInTheDocument();
      expect(screen.getByTestId('preview-marker')).toBeInTheDocument();
    },
  );

  it('exposes the source pane with the editor-pane-source class so cursor-follow CSS applies', () => {
    render(<EditorArea {...baseProps} currentMode="Editor" />);
    const surface = screen.getByTestId('editor-surface-source');
    expect(surface.className).toContain('editor-pane-source');
  });

  it('wraps WYSIWYG content in a Notion-like page surface with the active document title', () => {
    render(<EditorArea {...baseProps} currentMode="Wysiwyg" activeDocumentName="project-plan.md" />);

    const shell = screen.getByTestId('notion-editor-shell');

    expect(shell).toBeInTheDocument();
    expect(shell).toHaveClass('notion-editor-shell');
    expect(screen.getByRole('heading', { name: 'project-plan' })).toBeInTheDocument();
    expect(screen.getByTestId('wysiwyg-marker').parentElement).toHaveClass('notion-editor-content');
  });
});
