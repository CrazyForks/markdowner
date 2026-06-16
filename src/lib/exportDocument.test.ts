import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildExportHtml, exportBaseName, renderMarkdownToHtml } from './exportDocument';

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
