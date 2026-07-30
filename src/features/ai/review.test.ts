import { describe, expect, it } from 'vitest';

import { resolveReviewActions } from './review';

describe('resolveReviewActions', () => {
  it('keeps stale results inspectable without allowing either apply action', () => {
    expect(
      resolveReviewActions({
        sourcePresent: true,
        sourceRevisionMatches: false,
        validationPassed: true,
      }),
    ).toEqual({
      applySelected: false,
      applyAll: false,
      openAsDocument: true,
      rerun: true,
    });
  });

  it('blocks every result-consuming action when validation failed', () => {
    expect(
      resolveReviewActions({
        sourcePresent: true,
        sourceRevisionMatches: true,
        validationPassed: false,
      }),
    ).toEqual({
      applySelected: false,
      applyAll: false,
      openAsDocument: false,
      rerun: true,
    });
  });

  it('allows all review actions for a valid result whose source is current', () => {
    expect(
      resolveReviewActions({
        sourcePresent: true,
        sourceRevisionMatches: true,
        validationPassed: true,
      }),
    ).toEqual({
      applySelected: true,
      applyAll: true,
      openAsDocument: true,
      rerun: true,
    });
  });
});
