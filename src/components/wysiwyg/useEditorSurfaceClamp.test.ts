import { describe, expect, it } from 'vitest';

import { clampAxisDelta } from './useEditorSurfaceClamp';

/**
 * The clamp math that keeps floating editor popovers inside the editor surface.
 * `clampAxisDelta(start, end, min, max, margin)` returns the offset to ADD to
 * the popover so [start, end] fits within [min + margin, max - margin].
 */
describe('clampAxisDelta', () => {
  const MIN = 100;
  const MAX = 500;
  const MARGIN = 8;
  // Usable band: [108, 492].

  it('returns 0 when the popover is fully inside the bounds', () => {
    expect(clampAxisDelta(200, 300, MIN, MAX, MARGIN)).toBe(0);
  });

  it('shifts right (positive) when overflowing the low edge', () => {
    // Popover [80, 180] → left edge 80 < 108, shift +28 so left lands on 108.
    expect(clampAxisDelta(80, 180, MIN, MAX, MARGIN)).toBe(28);
  });

  it('shifts left (negative) when overflowing the high edge', () => {
    // Popover [420, 520] → right edge 520 > 492, shift -28 so right lands on 492.
    expect(clampAxisDelta(420, 520, MIN, MAX, MARGIN)).toBe(-28);
  });

  it('pins to the low edge when the popover is larger than the slot', () => {
    // Width 600 > band width 384 → align left edge to 108 regardless of start.
    expect(clampAxisDelta(50, 650, MIN, MAX, MARGIN)).toBe(58); // 108 - 50
  });

  it('respects the margin exactly at the boundary', () => {
    expect(clampAxisDelta(108, 200, MIN, MAX, MARGIN)).toBe(0);
    expect(clampAxisDelta(400, 492, MIN, MAX, MARGIN)).toBe(0);
  });
});
