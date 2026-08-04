import remarkGfm from 'remark-gfm';

export const GFM_MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
} as const;

export const GFM_REMARK_PLUGINS = [remarkGfm];
