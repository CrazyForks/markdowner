import { describe, expect, it, vi } from 'vitest';
import { Fragment, Schema, Slice } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { serializeWysiwygSliceToMarkdown } from './wysiwygCopy';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      toDOM: () => ['h1', 0],
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0] },
  },
});

function sliceOf(...children: ProseMirrorNode[]) {
  return new Slice(Fragment.from(children), 1, 1);
}

function editorWithManager(serialize: ((content: unknown) => string) | undefined) {
  return { storage: { markdown: { manager: { serialize } } } };
}

describe('serializeWysiwygSliceToMarkdown', () => {
  const boldSlice = sliceOf(
    schema.nodes.paragraph.create(null, [
      schema.text('plain '),
      schema.text('bold', [schema.marks.bold.create()]),
    ]),
  );

  it('serializes the slice content through the markdown manager', () => {
    const serialize = vi.fn().mockReturnValue('plain **bold**');
    const result = serializeWysiwygSliceToMarkdown(boldSlice, editorWithManager(serialize));

    expect(result).toBe('plain **bold**');
    expect(serialize).toHaveBeenCalledTimes(1);
    // The manager receives a doc-wrapped node array (bare arrays would lose
    // the blank line between top-level blocks), marks included.
    expect(serialize).toHaveBeenCalledWith({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    });
  });

  it('passes multi-block selections as a doc-wrapped node array', () => {
    const serialize = vi.fn().mockReturnValue('# Title\n\nBody');
    const slice = sliceOf(
      schema.nodes.heading.create({ level: 1 }, [schema.text('Title')]),
      schema.nodes.paragraph.create(null, [schema.text('Body')]),
    );

    expect(serializeWysiwygSliceToMarkdown(slice, editorWithManager(serialize))).toBe(
      '# Title\n\nBody',
    );
    expect(serialize.mock.calls[0][0].type).toBe('doc');
    expect(serialize.mock.calls[0][0].content).toHaveLength(2);
  });

  it('returns an empty string when no editor or markdown manager is available', () => {
    expect(serializeWysiwygSliceToMarkdown(boldSlice, null)).toBe('');
    expect(serializeWysiwygSliceToMarkdown(boldSlice, {})).toBe('');
    expect(serializeWysiwygSliceToMarkdown(boldSlice, editorWithManager(undefined))).toBe('');
  });

  it('returns an empty string for an empty slice so the default copy runs', () => {
    const serialize = vi.fn();
    expect(serializeWysiwygSliceToMarkdown(Slice.empty, editorWithManager(serialize))).toBe('');
    expect(serialize).not.toHaveBeenCalled();
  });

  it('returns an empty string when the manager throws', () => {
    const serialize = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    expect(serializeWysiwygSliceToMarkdown(boldSlice, editorWithManager(serialize))).toBe('');
  });
});
