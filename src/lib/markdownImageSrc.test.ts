import { describe, expect, it, vi } from 'vitest';

import { resolveMarkdownImageLocalPath, resolveMarkdownImageSrc } from './markdownImageSrc';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
}));

describe('resolveMarkdownImageSrc', () => {
  it('resolves relative README image paths from the active document directory', () => {
    expect(
      resolveMarkdownImageSrc(
        './assets/images/og.png',
        '/tmp/markdowner/README.md',
      ),
    ).toBe('asset:///tmp/markdowner/assets/images/og.png');
  });

  it('keeps GitHub-style remote badge image URLs unchanged', () => {
    const src = 'https://img.shields.io/badge/license-MIT-2ea44f';

    expect(resolveMarkdownImageSrc(src, '/tmp/markdowner/README.md')).toBe(src);
  });

  it('keeps data and blob image URLs unchanged', () => {
    expect(resolveMarkdownImageSrc('data:image/png;base64,abc', '/tmp/a.md')).toBe(
      'data:image/png;base64,abc',
    );
    expect(resolveMarkdownImageSrc('blob:http://asset.localhost/abc', '/tmp/a.md')).toBe(
      'blob:http://asset.localhost/abc',
    );
  });

  it('converts absolute local image paths to Tauri asset URLs', () => {
    expect(resolveMarkdownImageSrc('/tmp/markdowner/logo.png', '/tmp/markdowner/README.md')).toBe(
      'asset:///tmp/markdowner/logo.png',
    );
  });
});

describe('resolveMarkdownImageLocalPath', () => {
  it('resolves relative paths against the document directory (no asset protocol)', () => {
    expect(
      resolveMarkdownImageLocalPath('./assets/og.png', '/tmp/markdowner/README.md'),
    ).toBe('/tmp/markdowner/assets/og.png');
  });

  it('returns absolute local paths verbatim, dropping any query/hash', () => {
    expect(resolveMarkdownImageLocalPath('/tmp/logo.png?v=2', '/tmp/README.md')).toBe(
      '/tmp/logo.png',
    );
  });

  it('decodes file: URLs to plain paths', () => {
    expect(resolveMarkdownImageLocalPath('file:///tmp/a%20b.png', '/tmp/README.md')).toBe(
      '/tmp/a b.png',
    );
  });

  it('returns null for remote, data, blob and anchor sources', () => {
    expect(resolveMarkdownImageLocalPath('https://example.com/a.png', '/tmp/a.md')).toBeNull();
    expect(resolveMarkdownImageLocalPath('data:image/png;base64,abc', '/tmp/a.md')).toBeNull();
    expect(resolveMarkdownImageLocalPath('blob:http://x/abc', '/tmp/a.md')).toBeNull();
    expect(resolveMarkdownImageLocalPath('#anchor', '/tmp/a.md')).toBeNull();
  });

  it('returns null for a relative path when the document is unsaved', () => {
    expect(resolveMarkdownImageLocalPath('./pic.png', null)).toBeNull();
  });
});
