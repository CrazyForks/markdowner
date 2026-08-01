import { collectMarkdownHeadings } from './markdownHeadings';
import { parseLeadingFrontMatter } from './frontMatter';

export interface OutlineItem {
  id: string;
  title: string;
  depth: number;
  titleStart: number;
  titleEnd: number;
  selectionStart: number;
  selectionEnd: number;
}

export function parseMarkdownOutline(source: string): OutlineItem[] {
  const frontMatter = parseLeadingFrontMatter(source);
  return collectMarkdownHeadings(frontMatter.body).map((heading, index) => {
    const offset = frontMatter.bodyOffset;
    return {
      id: `${index}-${heading.selectionStart + offset}`,
      ...heading,
      titleStart: heading.titleStart + offset,
      titleEnd: heading.titleEnd + offset,
      selectionStart: heading.selectionStart + offset,
      selectionEnd: heading.selectionEnd + offset,
    };
  });
}
