import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

import { GFM_MARKED_OPTIONS, GFM_REMARK_PLUGINS } from './gfm';

describe('always-on GFM policy', () => {
  it('enables GFM without converting soft line breaks to hard breaks', () => {
    expect(GFM_MARKED_OPTIONS).toEqual({ gfm: true, breaks: false });
  });

  it('uses remark-gfm exactly once in React-Markdown renderers', () => {
    expect(GFM_REMARK_PLUGINS).toEqual([remarkGfm]);
  });
});
