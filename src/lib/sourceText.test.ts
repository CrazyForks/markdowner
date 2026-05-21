import { describe, expect, it } from 'vitest';

import {
  buildSourceLineStartOffsets,
  clampSourceOffset,
  normalizeFinalNewline,
  sourceOffsetForLine,
} from './sourceText';

describe('buildSourceLineStartOffsets', () => {
  it('records the zero-based start offset for each source line', () => {
    expect(buildSourceLineStartOffsets('alpha\nbeta\n')).toEqual([0, 6, 11]);
  });
});

describe('sourceOffsetForLine', () => {
  it('returns zero for invalid line numbers and clamps past-end lines to the source length', () => {
    const source = 'alpha\nbeta';
    const offsets = buildSourceLineStartOffsets(source);

    expect(sourceOffsetForLine(0, offsets, source.length)).toBe(0);
    expect(sourceOffsetForLine(Number.NaN, offsets, source.length)).toBe(0);
    expect(sourceOffsetForLine(2, offsets, source.length)).toBe(6);
    expect(sourceOffsetForLine(99, offsets, source.length)).toBe(source.length);
  });
});

describe('clampSourceOffset', () => {
  it('rounds finite offsets and clamps them to the source bounds', () => {
    expect(clampSourceOffset(-1, 10)).toBe(0);
    expect(clampSourceOffset(4.6, 10)).toBe(5);
    expect(clampSourceOffset(99, 10)).toBe(10);
    expect(clampSourceOffset(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });
});

describe('normalizeFinalNewline', () => {
  it('collapses every trailing newline run to exactly one newline', () => {
    expect(normalizeFinalNewline('')).toBe('\n');
    expect(normalizeFinalNewline('alpha')).toBe('alpha\n');
    expect(normalizeFinalNewline('alpha\n')).toBe('alpha\n');
    expect(normalizeFinalNewline('alpha\n\n\n')).toBe('alpha\n');
  });
});
