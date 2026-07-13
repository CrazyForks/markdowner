import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppMenu, type AppMenuModeOption } from './AppMenu';

const MODE_OPTIONS: ReadonlyArray<AppMenuModeOption> = [
  {
    mode: 'Editor',
    label: 'Editor',
    shortcutSymbol: '⌘K ⌘E',
    shortcutText: 'Cmd+K Cmd+E',
    ariaKeyshortcuts: 'Meta+K Meta+E',
  },
  {
    mode: 'Wysiwyg',
    label: 'WYSIWYG',
    shortcutSymbol: '⌘K ⌘W',
    shortcutText: 'Cmd+K Cmd+W',
    ariaKeyshortcuts: 'Meta+K Meta+W',
  },
  {
    mode: 'SplitView',
    label: 'Split View',
    shortcutSymbol: '⌘K ⌘S',
    shortcutText: 'Cmd+K Cmd+S',
    ariaKeyshortcuts: 'Meta+K Meta+S',
  },
];

function renderAppMenu(overrides: Partial<React.ComponentProps<typeof AppMenu>> = {}) {
  return render(
    <AppMenu
      busy={false}
      activeDocumentOpen
      hasWorkspaceRoot
      currentMode="Editor"
      modeOptions={MODE_OPTIONS}
      themeKind="BuiltInLight"
      themeMode="manual"
      onSave={() => {}}
      onSaveAs={() => {}}
      onImportTheme={() => {}}
      onExportHtml={() => {}}
      onExportPdf={() => {}}
      onExportWorkspaceHtml={() => {}}
      onExportWorkspacePdfs={() => {}}
      onSetMode={() => {}}
      onSetTheme={() => {}}
      onFollowSystemTheme={() => {}}
      onOpenSettings={() => {}}
      {...overrides}
    />,
  );
}

describe('AppMenu mode shortcuts', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the chord shortcut symbol next to each mode entry', () => {
    renderAppMenu();
    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));

    const editorRadio = screen.getByRole('menuitemradio', { name: /Editor/ });
    const wysiwygRadio = screen.getByRole('menuitemradio', { name: /WYSIWYG/ });
    const splitRadio = screen.getByRole('menuitemradio', { name: /Split View/ });

    expect(editorRadio).toHaveTextContent('⌘K ⌘E');
    expect(wysiwygRadio).toHaveTextContent('⌘K ⌘W');
    expect(splitRadio).toHaveTextContent('⌘K ⌘S');
  });

  it('exposes the chord aria-keyshortcuts on each mode entry', () => {
    renderAppMenu();
    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));

    expect(
      screen.getByRole('menuitemradio', { name: /Editor/ }).getAttribute('aria-keyshortcuts'),
    ).toBe('Meta+K Meta+E');
    expect(
      screen.getByRole('menuitemradio', { name: /WYSIWYG/ }).getAttribute('aria-keyshortcuts'),
    ).toBe('Meta+K Meta+W');
    expect(
      screen.getByRole('menuitemradio', { name: /Split View/ }).getAttribute('aria-keyshortcuts'),
    ).toBe('Meta+K Meta+S');
  });

  it('invokes onSetMode with the selected option', () => {
    const onSetMode = vi.fn();
    renderAppMenu({ onSetMode });
    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Split View/ }));
    expect(onSetMode).toHaveBeenCalledWith('SplitView');
  });

  it('invokes the export handlers from the Export menu items', () => {
    const onExportHtml = vi.fn();
    const onExportPdf = vi.fn();
    const onExportWorkspaceHtml = vi.fn();
    const onExportWorkspacePdfs = vi.fn();
    renderAppMenu({
      onExportHtml,
      onExportPdf,
      onExportWorkspaceHtml,
      onExportWorkspacePdfs,
    });
    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));

    fireEvent.click(screen.getByRole('menuitem', { name: /Export to HTML/ }));
    expect(onExportHtml).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Export to PDF/ }));
    expect(onExportPdf).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Export All Markdown to HTML/ }));
    expect(onExportWorkspaceHtml).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Export All Markdown to PDFs/ }));
    expect(onExportWorkspacePdfs).toHaveBeenCalledTimes(1);
  });

  it('disables the export items when no document is open', () => {
    renderAppMenu({ activeDocumentOpen: false });
    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));
    expect(screen.getByRole('menuitem', { name: /Export to HTML/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /Export to PDF/ })).toBeDisabled();
    expect(
      screen.getByRole('menuitem', { name: /Export All Markdown to HTML/ }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('menuitem', { name: /Export All Markdown to PDFs/ }),
    ).not.toBeDisabled();
  });

  it('disables all-markdown HTML and PDF export without a workspace root', () => {
    renderAppMenu({ hasWorkspaceRoot: false });
    fireEvent.click(screen.getByRole('button', { name: /app menu/i }));
    expect(screen.getByRole('menuitem', { name: /Export All Markdown to HTML/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /Export All Markdown to PDFs/ })).toBeDisabled();
  });
});
