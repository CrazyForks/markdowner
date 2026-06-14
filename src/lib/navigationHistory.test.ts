import { describe, expect, it } from 'vitest';

import {
  canGoBack,
  canGoForward,
  createNavigationHistory,
  goBack,
  goForward,
  recordNavigation,
} from './navigationHistory';

describe('navigationHistory', () => {
  it('starts empty with no back/forward available', () => {
    const state = createNavigationHistory();
    expect(state.entries).toEqual([]);
    expect(state.index).toBe(-1);
    expect(canGoBack(state)).toBe(false);
    expect(canGoForward(state)).toBe(false);
  });

  it('records visits and advances the index', () => {
    let state = createNavigationHistory();
    state = recordNavigation(state, '/a.md');
    expect(state).toEqual({ entries: ['/a.md'], index: 0 });
    expect(canGoBack(state)).toBe(false);

    state = recordNavigation(state, '/b.md');
    expect(state).toEqual({ entries: ['/a.md', '/b.md'], index: 1 });
    expect(canGoBack(state)).toBe(true);
    expect(canGoForward(state)).toBe(false);
  });

  it('skips empty paths and consecutive duplicates', () => {
    let state = recordNavigation(createNavigationHistory(), '/a.md');
    expect(recordNavigation(state, '')).toBe(state);
    expect(recordNavigation(state, '/a.md')).toBe(state);
    state = recordNavigation(state, '/b.md');
    expect(state.entries).toEqual(['/a.md', '/b.md']);
  });

  it('goes back and forward through the trail', () => {
    let state = recordNavigation(createNavigationHistory(), '/a.md');
    state = recordNavigation(state, '/b.md');

    const back = goBack(state);
    expect(back).not.toBeNull();
    expect(back!.path).toBe('/a.md');
    expect(back!.state.index).toBe(0);
    expect(canGoForward(back!.state)).toBe(true);

    const fwd = goForward(back!.state);
    expect(fwd).not.toBeNull();
    expect(fwd!.path).toBe('/b.md');
    expect(fwd!.state.index).toBe(1);
  });

  it('returns null at either end', () => {
    const start = recordNavigation(createNavigationHistory(), '/a.md');
    expect(goBack(start)).toBeNull();
    expect(goForward(start)).toBeNull();
  });

  it('drops forward entries when recording after going back', () => {
    let state = recordNavigation(createNavigationHistory(), '/a.md');
    state = recordNavigation(state, '/b.md');
    state = recordNavigation(state, '/c.md');

    const back = goBack(state)!; // at /b.md (index 1)
    state = recordNavigation(back.state, '/d.md');

    expect(state.entries).toEqual(['/a.md', '/b.md', '/d.md']);
    expect(state.index).toBe(2);
    expect(canGoForward(state)).toBe(false);
  });
});
