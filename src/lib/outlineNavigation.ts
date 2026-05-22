import type { OutlineItem } from './outline';
import { countLiteralOccurrencesBefore } from './sourceText';

export interface OutlineNavigationTarget {
  sourceOffset: number;
  titleText: string;
  titleOccurrenceIndex: number;
}

export function resolveOutlineNavigationTarget(
  source: string,
  item: OutlineItem,
): OutlineNavigationTarget {
  const titleText = source.slice(item.titleStart, item.titleEnd) || item.title;

  return {
    sourceOffset: item.titleStart,
    titleText,
    titleOccurrenceIndex: countLiteralOccurrencesBefore(source, titleText, item.titleStart),
  };
}

export function resolveOutlineMatchByOccurrence<T>(
  matches: readonly T[],
  occurrenceIndex: number,
): T | undefined {
  return matches[occurrenceIndex] ?? matches[0];
}
