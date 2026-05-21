import { describe, expect, it } from 'vitest';

import { isDiscardCloseDecision, isSaveCloseDecision } from './closeDecision';

describe('isSaveCloseDecision', () => {
  it('accepts boolean true and save/yes strings', () => {
    expect(isSaveCloseDecision(true)).toBe(true);
    expect(isSaveCloseDecision(' save ')).toBe(true);
    expect(isSaveCloseDecision('YES')).toBe(true);
  });

  it('rejects discard and cancel decisions', () => {
    expect(isSaveCloseDecision(false)).toBe(false);
    expect(isSaveCloseDecision("don't save")).toBe(false);
    expect(isSaveCloseDecision(null)).toBe(false);
  });
});

describe('isDiscardCloseDecision', () => {
  it('accepts boolean false and no/discard strings', () => {
    expect(isDiscardCloseDecision(false)).toBe(true);
    expect(isDiscardCloseDecision(' no ')).toBe(true);
    expect(isDiscardCloseDecision('discard')).toBe(true);
  });

  it('normalizes apostrophes in dont-save decisions', () => {
    expect(isDiscardCloseDecision("don't save")).toBe(true);
    expect(isDiscardCloseDecision('don\u2019t save')).toBe(true);
    expect(isDiscardCloseDecision('dont save')).toBe(true);
  });

  it('rejects save and cancel decisions', () => {
    expect(isDiscardCloseDecision(true)).toBe(false);
    expect(isDiscardCloseDecision('save')).toBe(false);
    expect(isDiscardCloseDecision(undefined)).toBe(false);
  });
});
