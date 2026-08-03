import { describe, expect, it } from 'vitest';

import { parseMarkdownOutline } from './outline';
import obsidianFixture from '../../tests/fixtures/obsidian-frontmatter.md?raw';

describe('parseMarkdownOutline', () => {
  it('excludes properties while retaining full-source heading offsets', () => {
    expect(parseMarkdownOutline(obsidianFixture)).toEqual([]);
    const source = `${obsidianFixture}# Article notes\n`;
    expect(parseMarkdownOutline(source)).toEqual([
      expect.objectContaining({
        title: 'Article notes',
        selectionStart: obsidianFixture.length,
      }),
    ]);
  });
  it('returns heading depth, display title, and source ranges', () => {
    const source = ['# Agenda', '', '##   Decisions   ###', 'Notes', '### Follow-up'].join('\n');

    expect(parseMarkdownOutline(source)).toEqual([
      {
        id: '0-0',
        depth: 1,
        title: 'Agenda',
        titleStart: 2,
        titleEnd: 8,
        selectionStart: 0,
        selectionEnd: 8,
      },
      {
        id: '1-10',
        depth: 2,
        title: 'Decisions',
        titleStart: 15,
        titleEnd: 24,
        selectionStart: 10,
        selectionEnd: 30,
      },
      {
        id: '2-37',
        depth: 3,
        title: 'Follow-up',
        titleStart: 41,
        titleEnd: 50,
        selectionStart: 37,
        selectionEnd: 50,
      },
    ]);
  });

  it('ignores non-headings and hashes deeper than six levels', () => {
    expect(parseMarkdownOutline(['Body', '####### Too deep', '# Valid'].join('\n'))).toEqual([
      {
        id: '0-22',
        depth: 1,
        title: 'Valid',
        titleStart: 24,
        titleEnd: 29,
        selectionStart: 22,
        selectionEnd: 29,
      },
    ]);
  });

  it('keeps compatibility H5/H6 headings navigable at their source depth', () => {
    expect(
      parseMarkdownOutline('##### Five\n###### Six').map(({ depth, title }) => ({
        depth,
        title,
      })),
    ).toEqual([
      { depth: 5, title: 'Five' },
      { depth: 6, title: 'Six' },
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const source = [
      '# Visible',
      '',
      '```python',
      '# Not an outline heading',
      'print("still code")',
      '```',
      '',
      '## Also visible',
    ].join('\n');

    expect(parseMarkdownOutline(source).map((item) => item.title)).toEqual([
      'Visible',
      'Also visible',
    ]);
  });
});
