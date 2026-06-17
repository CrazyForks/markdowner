import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildExportHtml,
  buildWorkspacePdfExportTargets,
  defaultPdfExportPath,
  exportBaseName,
  renderMarkdownToHtml,
} from './exportDocument';

describe('exportBaseName', () => {
  it('strips markdown extensions', () => {
    expect(exportBaseName('notes.md')).toBe('notes');
    expect(exportBaseName('readme.markdown')).toBe('readme');
    expect(exportBaseName('a.MKD')).toBe('a');
  });

  it('falls back to Untitled for empty/missing names', () => {
    expect(exportBaseName(null)).toBe('Untitled');
    expect(exportBaseName(undefined)).toBe('Untitled');
    expect(exportBaseName('')).toBe('Untitled');
  });
});

describe('renderMarkdownToHtml', () => {
  it('renders GFM markdown to static HTML', () => {
    const html = renderMarkdownToHtml('# Title\n\n- one\n- two', null);
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('<li');
  });
});

describe('defaultPdfExportPath', () => {
  it('defaults to a PDF beside the saved active document', () => {
    expect(defaultPdfExportPath('/tmp/project/docs/guide.md', 'guide.md')).toBe(
      '/tmp/project/docs/guide.pdf',
    );
  });

  it('falls back to the document name for untitled documents', () => {
    expect(defaultPdfExportPath(null, 'Draft.markdown')).toBe('Draft.pdf');
  });
});

describe('buildWorkspacePdfExportTargets', () => {
  it('preserves the project-relative folder structure under exports', () => {
    expect(
      buildWorkspacePdfExportTargets({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/docs/guide.markdown',
          '/tmp/project/deep/nested/spec.MKD',
        ],
      }),
    ).toEqual([
      {
        sourcePath: '/tmp/project/README.md',
        outputPath: '/tmp/project/exports/README.pdf',
        title: 'README',
      },
      {
        sourcePath: '/tmp/project/docs/guide.markdown',
        outputPath: '/tmp/project/exports/docs/guide.pdf',
        title: 'guide',
      },
      {
        sourcePath: '/tmp/project/deep/nested/spec.MKD',
        outputPath: '/tmp/project/exports/deep/nested/spec.pdf',
        title: 'spec',
      },
    ]);
  });

  it('skips files already inside exports and de-duplicates source paths', () => {
    expect(
      buildWorkspacePdfExportTargets({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/docs/guide.md',
          '/tmp/project/docs/guide.md',
          '/tmp/project/exports/docs/guide.md',
          '/tmp/project/notes.txt',
          '/tmp/other/outside.md',
        ],
      }),
    ).toEqual([
      {
        sourcePath: '/tmp/project/docs/guide.md',
        outputPath: '/tmp/project/exports/docs/guide.pdf',
        title: 'guide',
      },
    ]);
  });

  it('keeps the source path separator style when building export targets', () => {
    expect(
      buildWorkspacePdfExportTargets({
        rootDir: 'C:\\Users\\chann\\project',
        workspaceDocuments: ['C:\\Users\\chann\\project\\docs\\guide.md'],
      }),
    ).toEqual([
      {
        sourcePath: 'C:\\Users\\chann\\project\\docs\\guide.md',
        outputPath: 'C:\\Users\\chann\\project\\exports\\docs\\guide.pdf',
        title: 'guide',
      },
    ]);
  });
});

describe('buildExportHtml', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'BuiltInDark';
    document.documentElement.dataset.cbTheme = 'one-dark';
    document.documentElement.dataset.cbHighlight = 'on';
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.cbTheme;
    delete document.documentElement.dataset.cbHighlight;
  });

  it('produces a standalone document mirroring the live theme attributes', () => {
    const html = buildExportHtml({ title: 'My Doc', source: '# Hello', activeDocumentPath: null });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>My Doc</title>');
    expect(html).toContain('data-cb-theme="one-dark"');
    expect(html).toContain('data-cb-highlight="on"');
    expect(html).toContain('markdowner-content');
    expect(html).toContain('markdown-surface');
    expect(html).toContain('Hello');
    expect(html).not.toContain('@page');
  });

  it('adds print page rules sized to the requested paper when printing', () => {
    const html = buildExportHtml({
      title: 'P',
      source: 'x',
      activeDocumentPath: null,
      forPrint: true,
      paperSize: 'Letter',
    });
    expect(html).toContain('@page { size: Letter');
  });

  it('escapes the title to avoid breaking the document', () => {
    const html = buildExportHtml({ title: 'a<b>&"', source: 'x', activeDocumentPath: null });
    expect(html).toContain('<title>a&lt;b&gt;&amp;&quot;</title>');
  });
});
