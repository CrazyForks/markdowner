import { createElement } from 'react';
import type { Components } from 'react-markdown';

type MarkdownSourceNode = {
  position?: {
    start?: {
      line?: number;
      offset?: number;
    };
    end?: {
      offset?: number;
    };
  };
};

type MarkdownSourceLineProps = {
  node?: MarkdownSourceNode;
};

export function createSourceLineComponent(tagName: keyof HTMLElementTagNameMap) {
  return function SourceLineComponent(props: MarkdownSourceLineProps) {
    const { node, ...elementProps } = props as MarkdownSourceLineProps & Record<string, unknown>;
    const sourceLine = node?.position?.start?.line;
    const sourceOffset = node?.position?.start?.offset;
    const sourceEndOffset = node?.position?.end?.offset;

    return createElement(tagName, {
      ...elementProps,
      'data-source-line': Number.isFinite(sourceLine) ? sourceLine : undefined,
      'data-source-offset': Number.isFinite(sourceOffset) ? sourceOffset : undefined,
      'data-source-end-offset': Number.isFinite(sourceEndOffset) ? sourceEndOffset : undefined,
    });
  };
}

export const sourceLineMarkdownComponents = {
  h1: createSourceLineComponent('h1'),
  h2: createSourceLineComponent('h2'),
  h3: createSourceLineComponent('h3'),
  h4: createSourceLineComponent('h4'),
  h5: createSourceLineComponent('h5'),
  h6: createSourceLineComponent('h6'),
  p: createSourceLineComponent('p'),
  li: createSourceLineComponent('li'),
  blockquote: createSourceLineComponent('blockquote'),
  pre: createSourceLineComponent('pre'),
  table: createSourceLineComponent('table'),
  tr: createSourceLineComponent('tr'),
} satisfies Components;
