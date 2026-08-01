import { describe, expect, it } from 'vitest';

import fixture from '../../tests/fixtures/obsidian-frontmatter.md?raw';

import {
  FrontMatterMutationError,
  addFrontMatterProperty,
  deleteFrontMatterProperty,
  markdownBody,
  parseLeadingFrontMatter,
  replaceFrontMatterProperty,
} from './frontMatter';

describe('lossless Obsidian front matter', () => {
  it('projects the clipping fixture without changing one byte', () => {
    const parsed = parseLeadingFrontMatter(fixture);

    expect(parsed.hasFrontMatter).toBe(true);
    expect(parsed.valid).toBe(true);
    expect(parsed.raw + parsed.body).toBe(fixture);
    expect(parsed.body).toBe('');
    expect(parsed.properties.find((property) => property.key === 'title')).toMatchObject({
      kind: 'string',
      displayValue: 'AI가 코드를 짜주는 시대에, 우리는 왜 개발자를 찾을까요?',
    });
    expect(parsed.properties.find((property) => property.key === 'author')).toMatchObject({
      kind: 'string-list',
      displayValue: ['[[Career]]'],
    });
    expect(parsed.properties.find((property) => property.key === 'published')?.kind).toBe('date');
  });

  it('replaces only the selected authored value range', () => {
    expect(replaceFrontMatterProperty(fixture, 'description', 'Expanded')).toBe(
      fixture.replace('description: "More"', 'description: "Expanded"'),
    );
  });

  it('adds and deletes simple properties while retaining the remaining bytes', () => {
    const added = addFrontMatterProperty(fixture, 'reviewed', true);
    expect(added).toContain('reviewed: true\n---\n');
    expect(deleteFrontMatterProperty(added, 'reviewed')).toBe(fixture);
  });

  it('supports CRLF and the alternate closing marker', () => {
    const source = '---\r\ntitle: "A"\r\n...\r\n# Body\r\n';
    const parsed = parseLeadingFrontMatter(source);
    expect(parsed.newline).toBe('\r\n');
    expect(parsed.closingMarker).toBe('...');
    expect(parsed.raw + parsed.body).toBe(source);
    expect(markdownBody(source)).toBe('# Body\r\n');
  });

  it.each([
    '---\na: 1\na: 2\n---\n',
    '---\nbody: |\n  text\n---\n',
    '---\ndefaults: &defaults\n  a: 1\n---\n',
    '---\nvalue: !custom thing\n---\n',
    '---\ninvalid: [\n---\n',
  ])('falls back to raw editing for ambiguous YAML', (source) => {
    const parsed = parseLeadingFrontMatter(source);
    expect(parsed.hasFrontMatter).toBe(true);
    expect(parsed.valid).toBe(false);
    expect(() => replaceFrontMatterProperty(source, 'a', 3)).toThrow(
      FrontMatterMutationError,
    );
  });

  it.each([
    '\uFEFF---\ntitle: A\n---\n',
    '---\ntitle: A\n',
    '# Body\n\n---\n',
  ])('does not claim text without a safe leading boundary', (source) => {
    expect(parseLeadingFrontMatter(source).hasFrontMatter).toBe(false);
    expect(markdownBody(source)).toBe(source);
  });
});
