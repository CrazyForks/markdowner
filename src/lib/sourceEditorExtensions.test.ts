import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let themeIndex = 0;

  return {
    markdown: vi.fn(() => 'markdown-extension'),
    createSourceLinkClickExtension: vi.fn(() => 'source-link-click-extension'),
    createSourceInlineCodeExtension: vi.fn(() => 'source-inline-code-extension'),
    createSourceSkillCompletionExtension: vi.fn(
      () => 'source-skill-completion-extension',
    ),
    lineWrapping: 'line-wrapping-extension',
    theme: vi.fn(() => `theme-extension-${++themeIndex}`),
    updateListenerOf: vi.fn((listener: unknown) => ({
      kind: 'update-listener',
      listener,
    })),
  };
});

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: mocks.markdown,
}));

vi.mock('@uiw/react-codemirror', () => ({
  EditorView: {
    lineWrapping: mocks.lineWrapping,
    theme: mocks.theme,
    updateListener: {
      of: mocks.updateListenerOf,
    },
    decorations: {
      from: vi.fn(() => 'decorations-from'),
    },
  },
  // Minimal stand-ins for the find-highlight field defined at module load.
  // Real decoration behavior is covered by sourceFindHighlight.test.ts,
  // which uses the unmocked library.
  StateEffect: {
    define: vi.fn(() => ({ of: vi.fn(), is: vi.fn() })),
  },
  StateField: {
    define: vi.fn(() => 'find-highlight-field'),
  },
  Decoration: {
    mark: vi.fn(() => ({ range: vi.fn() })),
    none: 'decoration-none',
    set: vi.fn(),
  },
}));

vi.mock('./sourceLinkClick', () => ({
  createSourceLinkClickExtension: mocks.createSourceLinkClickExtension,
}));

vi.mock('./sourceInlineCode', () => ({
  createSourceInlineCodeExtension: mocks.createSourceInlineCodeExtension,
}));

vi.mock('./sourceSkillCompletion', () => ({
  createSourceSkillCompletionExtension:
    mocks.createSourceSkillCompletionExtension,
}));

import {
  buildSourceEditorExtensions,
  sourceFocusModeExtension,
  sourceTypewriterModeExtension,
} from './sourceEditorExtensions';

describe('buildSourceEditorExtensions', () => {
  it('builds CodeMirror extensions in stable order from editor settings', () => {
    const onViewportChange = vi.fn();
    const onTypewriterChange = vi.fn();

    const extensions = buildSourceEditorExtensions({
      editorLineWrap: true,
      focusModeEnabled: true,
      typewriterModeEnabled: true,
      skillNames: new Set(['goal']),
      onViewportChange,
      onTypewriterChange,
    });

    expect(mocks.markdown).toHaveBeenCalledTimes(1);
    expect(mocks.createSourceLinkClickExtension).toHaveBeenCalledWith();
    expect(mocks.createSourceInlineCodeExtension).toHaveBeenCalledWith();
    expect(mocks.createSourceSkillCompletionExtension).toHaveBeenCalledWith(
      new Set(['goal']),
    );
    expect(extensions).toEqual([
      'markdown-extension',
      'find-highlight-field',
      'source-link-click-extension',
      'source-inline-code-extension',
      'source-skill-completion-extension',
      mocks.lineWrapping,
      sourceFocusModeExtension,
      sourceTypewriterModeExtension,
      expect.objectContaining({ kind: 'update-listener' }),
    ]);
  });

  it('routes update listener events to App-owned callbacks', () => {
    const onViewportChange = vi.fn();
    const onTypewriterChange = vi.fn();
    const onSelectionChange = vi.fn();
    const scrollDOM = document.createElement('div');
    const view = { scrollDOM };

    const extensions = buildSourceEditorExtensions({
      editorLineWrap: false,
      focusModeEnabled: false,
      typewriterModeEnabled: false,
      skillNames: new Set(),
      onViewportChange,
      onTypewriterChange,
      onSelectionChange,
    });
    const updateListener = extensions[extensions.length - 1] as {
      listener: (update: {
        viewportChanged: boolean;
        selectionSet: boolean;
        docChanged: boolean;
        focusChanged: boolean;
        view: typeof view;
      }) => void;
    };

    expect(extensions).toEqual([
      'markdown-extension',
      'find-highlight-field',
      'source-link-click-extension',
      'source-inline-code-extension',
      'source-skill-completion-extension',
      expect.objectContaining({ kind: 'update-listener' }),
    ]);

    updateListener.listener({
      viewportChanged: true,
      selectionSet: true,
      docChanged: false,
      focusChanged: false,
      view,
    });

    expect(onViewportChange).toHaveBeenCalledWith(scrollDOM);
    expect(onTypewriterChange).toHaveBeenCalledWith(view);
    expect(onSelectionChange).toHaveBeenCalledWith(view);

    onViewportChange.mockClear();
    onTypewriterChange.mockClear();
    onSelectionChange.mockClear();

    updateListener.listener({
      viewportChanged: false,
      selectionSet: false,
      docChanged: false,
      focusChanged: false,
      view,
    });

    expect(onViewportChange).not.toHaveBeenCalled();
    expect(onTypewriterChange).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});
