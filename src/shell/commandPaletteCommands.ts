import type { EditorMode, ThemeKind } from '@/lib/desktop';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import { EDITOR_MODE_OPTIONS } from '@/lib/shellDisplay';
import type { CommandPaletteCommand } from './CommandPalette';

export type CommandPaletteActions = {
  newDocument: () => void;
  openDocument: () => void;
  openWorkspace: () => void;
  save: () => void;
  saveAs: () => void;
  toggleSidebar: () => void;
  showExplorerPanel: () => void;
  focusExplorerTree: () => void;
  toggleOutline: () => void;
  openQuickOpen: () => void;
  focusSearchPanel: () => void;
  openFindReplace: (replaceMode: boolean) => void;
  setMode: (mode: EditorMode) => void;
  updateSettings: (settings: Settings) => void;
  openSettings: () => void;
  openKeymap: () => void;
  installCliLauncher: () => void;
  openDocumentStats: () => void;
  setTheme: (themeKind: ThemeKind) => void;
  followSystemTheme: () => void;
  importTheme: () => void;
};

type BuildCommandPaletteCommandsInput = {
  activeDocumentOpen: boolean;
  settings: Settings;
  actions: CommandPaletteActions;
};

export function buildCommandPaletteCommands(
  input: BuildCommandPaletteCommandsInput,
): CommandPaletteCommand[] {
  const { actions, activeDocumentOpen, settings } = input;

  return [
    {
      id: 'file.new',
      category: 'File',
      label: 'New Document',
      shortcut: '⌘N',
      run: actions.newDocument,
    },
    {
      id: 'file.open',
      category: 'File',
      label: 'Open File…',
      shortcut: '⌘O',
      run: actions.openDocument,
    },
    {
      id: 'file.openWorkspace',
      category: 'File',
      label: 'Open Workspace…',
      shortcut: '⌘⇧O',
      run: actions.openWorkspace,
    },
    {
      id: 'file.save',
      category: 'File',
      label: 'Save',
      shortcut: '⌘S',
      disabled: !activeDocumentOpen,
      run: actions.save,
    },
    {
      id: 'file.saveAs',
      category: 'File',
      label: 'Save As…',
      shortcut: '⌘⇧S',
      disabled: !activeDocumentOpen,
      run: actions.saveAs,
    },
    {
      id: 'view.toggleSidebar',
      category: 'View',
      label: 'Toggle Sidebar',
      shortcut: '⌘⇧B',
      run: actions.toggleSidebar,
    },
    {
      id: 'view.showExplorer',
      category: 'View',
      label: 'Show Explorer',
      shortcut: '⌘⇧E',
      run: () => {
        actions.showExplorerPanel();
        actions.focusExplorerTree();
      },
    },
    {
      id: 'view.toggleOutline',
      category: 'View',
      label: 'Toggle Outline',
      shortcut: '⌘⇧D',
      run: actions.toggleOutline,
    },
    {
      id: 'view.quickOpen',
      category: 'View',
      label: 'Quick Open File…',
      shortcut: '⌘P',
      run: actions.openQuickOpen,
    },
    {
      id: 'view.searchInFiles',
      category: 'View',
      label: 'Search: Find in Files',
      shortcut: '⌘⇧F',
      run: actions.focusSearchPanel,
    },
    {
      id: 'view.findInFile',
      category: 'View',
      label: 'Find in Current File',
      shortcut: '⌘F',
      disabled: !activeDocumentOpen,
      run: () => actions.openFindReplace(false),
    },
    ...EDITOR_MODE_OPTIONS.map((option) => ({
      id: `view.mode.${option.mode}`,
      category: 'View',
      label: `Mode: ${option.label}`,
      shortcut: option.shortcutSymbol,
      run: () => actions.setMode(option.mode),
    })),
    {
      id: 'preferences.toggleFocusMode',
      category: 'Preferences',
      label: settings.focusModeEnabled ? 'Disable Focus Mode' : 'Enable Focus Mode',
      shortcut: '⌘⇧J',
      run: () =>
        actions.updateSettings({
          ...settings,
          focusModeEnabled: !settings.focusModeEnabled,
        }),
    },
    {
      id: 'preferences.toggleTypewriterMode',
      category: 'Preferences',
      label: settings.typewriterModeEnabled ? 'Disable Typewriter Mode' : 'Enable Typewriter Mode',
      shortcut: '⌘⇧Y',
      run: () =>
        actions.updateSettings({
          ...settings,
          typewriterModeEnabled: !settings.typewriterModeEnabled,
        }),
    },
    {
      id: 'preferences.toggleWordWrap',
      category: 'Preferences',
      label: settings.editorLineWrap ? 'Disable Word Wrap' : 'Enable Word Wrap',
      shortcut: '⌥Z',
      run: () =>
        actions.updateSettings({
          ...settings,
          editorLineWrap: !settings.editorLineWrap,
        }),
    },
    {
      id: 'preferences.toggleTableViewMode',
      category: 'Preferences',
      label:
        settings.tableViewMode === 'inline'
          ? 'Table View: Normal (wrap)'
          : 'Table View: Inline (no wrap, scroll)',
      shortcut: '⌘⇧M',
      run: () =>
        actions.updateSettings({
          ...settings,
          tableViewMode: settings.tableViewMode === 'inline' ? 'normal' : 'inline',
        }),
    },
    {
      id: 'preferences.toggleAutoSave',
      category: 'Preferences',
      label: settings.autoSave ? 'Disable Auto Save' : 'Enable Auto Save',
      run: () => actions.updateSettings({ ...settings, autoSave: !settings.autoSave }),
    },
    {
      id: 'app.settings',
      category: 'Preferences',
      label: 'Open Settings',
      shortcut: '⌘,',
      run: actions.openSettings,
    },
    {
      id: 'app.openKeymap',
      category: 'Preferences',
      label: 'Open Keymap (Keyboard Shortcuts)',
      shortcut: '⌘/',
      run: actions.openKeymap,
    },
    {
      id: 'app.installCliLauncher',
      category: 'Preferences',
      label: 'Install Markdowner in PATH',
      run: actions.installCliLauncher,
    },
    {
      id: 'app.documentStats',
      category: 'Preferences',
      label: 'Open Document Stats',
      shortcut: '⌘⇧I',
      disabled: !activeDocumentOpen,
      run: actions.openDocumentStats,
    },
    {
      id: 'preferences.resetDefaults',
      category: 'Preferences',
      label: 'Reset Settings to Defaults',
      run: () => actions.updateSettings({ ...DEFAULT_SETTINGS }),
    },
    {
      id: 'theme.light',
      category: 'Theme',
      label: 'Theme: Light',
      run: () => actions.setTheme('BuiltInLight'),
    },
    {
      id: 'theme.dark',
      category: 'Theme',
      label: 'Theme: Dark',
      run: () => actions.setTheme('BuiltInDark'),
    },
    {
      id: 'theme.system',
      category: 'Theme',
      label: 'Theme: Follow System',
      run: actions.followSystemTheme,
    },
    {
      id: 'theme.import',
      category: 'Theme',
      label: 'Import CSS Theme…',
      run: actions.importTheme,
    },
  ];
}
