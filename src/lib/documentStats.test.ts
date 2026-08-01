import { describe, expect, it } from 'vitest';

import { calculateDocumentStats } from './documentStats';
import obsidianFixture from '../../tests/fixtures/obsidian-frontmatter.md?raw';

describe('calculateDocumentStats', () => {
  it('excludes leading Obsidian properties from body statistics', () => {
    expect(calculateDocumentStats(obsidianFixture)).toEqual({
      words: 0,
      characters: 0,
      readingTimeMinutes: 0,
      headings: 0,
      links: 0,
      images: 0,
      tables: 0,
    });
  });
  it('counts words, characters, headings, links, images, and markdown tables', () => {
    const source = [
      '# Report',
      '',
      'Alpha beta [docs](https://example.com) ![chart](chart.png).',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| One | 1 |',
      '',
      '## Next',
    ].join('\n');

    expect(calculateDocumentStats(source)).toEqual({
      words: 23,
      characters: source.length,
      readingTimeMinutes: 1,
      headings: 2,
      links: 1,
      images: 1,
      tables: 1,
    });
  });

  it('returns zero words and reading time for empty or whitespace-only input', () => {
    expect(calculateDocumentStats('   \n\t')).toMatchObject({
      words: 0,
      readingTimeMinutes: 0,
    });
  });

  it('rounds reading time up from the 200 words per minute baseline', () => {
    const source = Array.from({ length: 201 }, (_, index) => `word${index}`).join(' ');

    expect(calculateDocumentStats(source).readingTimeMinutes).toBe(2);
  });

  it('does not count headings inside fenced code blocks', () => {
    const source = [
      '# Report',
      '',
      '```sh',
      '# shell comment',
      'echo done',
      '```',
      '',
      '## Next',
    ].join('\n');

    expect(calculateDocumentStats(source).headings).toBe(2);
  });
});
