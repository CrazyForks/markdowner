import { describe, expect, it } from 'vitest';

import {
  moveTabToIndex,
  planTabDragPlacement,
  type TabSlot,
} from './tabDragReorder';

/** Four 100px-wide tabs starting at content x=0. */
function evenSlots(): TabSlot[] {
  return [
    { id: 'a', left: 0, width: 100 },
    { id: 'b', left: 100, width: 100 },
    { id: 'c', left: 200, width: 100 },
    { id: 'd', left: 300, width: 100 },
  ];
}

/** Uneven widths, the realistic case: file names differ in length. */
function unevenSlots(): TabSlot[] {
  return [
    { id: 'a', left: 0, width: 100 },
    { id: 'b', left: 100, width: 60 },
    { id: 'c', left: 160, width: 140 },
  ];
}

/**
 * Places the pointer so the dragged tab's left edge lands on `left`, given it was
 * grabbed `grab` px into the tab.
 */
function planAt(
  slots: TabSlot[],
  sourceIndex: number,
  left: number,
  grab = 0,
) {
  return planTabDragPlacement(slots, sourceIndex, left + grab, grab);
}

describe('planTabDragPlacement', () => {
  it('leaves the order untouched while the tab has not moved', () => {
    const placement = planAt(evenSlots(), 0, 0, 50);

    expect(placement.index).toBe(0);
    expect(placement.offsets).toEqual([0, 0, 0, 0]);
  });

  it('tracks the pointer on the dragged tab without displacing neighbours yet', () => {
    // 40px right: not yet half over `b`, so only the dragged tab moves.
    const placement = planAt(evenSlots(), 0, 40, 50);

    expect(placement.index).toBe(0);
    expect(placement.offsets).toEqual([40, 0, 0, 0]);
  });

  it('slides the neighbour aside once the dragged tab is half over it', () => {
    const placement = planAt(evenSlots(), 0, 51, 50);

    expect(placement.index).toBe(1);
    // `b` retreats by exactly the dragged tab's width.
    expect(placement.offsets).toEqual([51, -100, 0, 0]);
  });

  it('uses the same threshold in both directions so a resting pointer cannot oscillate', () => {
    // 50px is the shared boundary: neither direction claims it.
    expect(planAt(evenSlots(), 0, 50, 50).index).toBe(0);
    expect(planAt(evenSlots(), 0, 50.01, 50).index).toBe(1);
    expect(planAt(evenSlots(), 0, 49.99, 50).index).toBe(0);
  });

  it('displaces every tab the dragged tab has passed', () => {
    const placement = planAt(evenSlots(), 0, 160, 50);

    expect(placement.index).toBe(2);
    expect(placement.offsets).toEqual([160, -100, -100, 0]);
  });

  it('slides neighbours right when dragging leftwards', () => {
    const placement = planAt(evenSlots(), 3, 240, 50);

    expect(placement.index).toBe(2);
    expect(placement.offsets).toEqual([0, 0, 100, -60]);
  });

  it('reaches the first slot when dragged to the start of the strip', () => {
    const placement = planAt(evenSlots(), 3, 0, 50);

    expect(placement.index).toBe(0);
    expect(placement.offsets).toEqual([100, 100, 100, -300]);
  });

  it('thresholds on each neighbour’s own half width', () => {
    // `b` is 60px wide, so 30px of travel is enough to pass it.
    expect(planAt(unevenSlots(), 0, 29).index).toBe(0);
    expect(planAt(unevenSlots(), 0, 31).index).toBe(1);
    // `c` is 140px wide and starts 60px into the source-removed strip.
    expect(planAt(unevenSlots(), 0, 129).index).toBe(1);
    expect(planAt(unevenSlots(), 0, 131).index).toBe(2);
  });

  it('keeps the dragged tab inside the strip', () => {
    const slots = evenSlots();

    // Far left of the strip start.
    expect(planAt(slots, 2, -500, 50).offsets[2]).toBe(-200);
    // Past the trailing edge: the last slot is as far right as it goes.
    const trailing = planAt(slots, 0, 5000, 50);
    expect(trailing.offsets[0]).toBe(300);
    expect(trailing.index).toBe(3);
  });

  it('places a tab last when dragged into the trailing strip area', () => {
    const placement = planAt(unevenSlots(), 0, 1000);

    expect(placement.index).toBe(2);
    expect(placement.offsets[1]).toBe(-100);
    expect(placement.offsets[2]).toBe(-100);
  });

  it('measures from the strip start rather than assuming zero', () => {
    // A scrolled strip still reports content coordinates, but the first tab may
    // begin at a non-zero offset when the strip has leading chrome.
    const slots: TabSlot[] = [
      { id: 'a', left: 40, width: 100 },
      { id: 'b', left: 140, width: 100 },
    ];

    expect(planAt(slots, 0, 40, 50).index).toBe(0);
    expect(planAt(slots, 0, 91, 50).index).toBe(1);
    expect(planAt(slots, 0, 91, 50).offsets).toEqual([51, -100]);
  });

  it('cannot reorder a single-tab strip', () => {
    const placement = planAt([{ id: 'a', left: 0, width: 100 }], 0, 400, 50);

    expect(placement.index).toBe(0);
    expect(placement.offsets).toEqual([0]);
  });

  it('is inert for an unknown source index', () => {
    expect(planTabDragPlacement(evenSlots(), -1, 200, 0)).toEqual({
      index: -1,
      offsets: [0, 0, 0, 0],
    });
    expect(planTabDragPlacement(evenSlots(), 9, 200, 0)).toEqual({
      index: 9,
      offsets: [0, 0, 0, 0],
    });
  });

  it('is inert for an empty strip', () => {
    expect(planTabDragPlacement([], 0, 200, 0)).toEqual({ index: 0, offsets: [] });
  });
});

describe('moveTabToIndex', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const ids = (result: { id: string }[]) => result.map((tab) => tab.id);

  it('moves a tab forward', () => {
    expect(ids(moveTabToIndex(tabs, 'a', 2))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a tab backward', () => {
    expect(ids(moveTabToIndex(tabs, 'd', 1))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a tab to the end', () => {
    expect(ids(moveTabToIndex(tabs, 'b', 3))).toEqual(['a', 'c', 'd', 'b']);
  });

  it('keeps the order when the tab is already at that index', () => {
    expect(ids(moveTabToIndex(tabs, 'c', 2))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clamps an out-of-range index', () => {
    expect(ids(moveTabToIndex(tabs, 'b', 99))).toEqual(['a', 'c', 'd', 'b']);
    expect(ids(moveTabToIndex(tabs, 'c', -5))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns a copy for an unknown id', () => {
    const result = moveTabToIndex(tabs, 'zz', 0);

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd']);
    expect(result).not.toBe(tabs);
  });
});
