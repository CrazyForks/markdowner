import { findSkillTokenRanges } from './skillTokens';

type HastNode = {
  type: string;
  value?: unknown;
  tagName?: unknown;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

type HastText = HastNode & {
  type: 'text';
  value: string;
};

type HastParent = HastNode & {
  children: HastNode[];
};

function isTextNode(node: HastNode): node is HastText {
  return node.type === 'text' && typeof node.value === 'string';
}

function isParentNode(node: unknown): node is HastParent {
  return (
    typeof node === 'object' &&
    node !== null &&
    'children' in node &&
    Array.isArray(node.children)
  );
}

function wrapSkillTokens(
  text: string,
  skillNames: ReadonlySet<string>,
): HastNode[] {
  const ranges = findSkillTokenRanges(text, skillNames);
  if (ranges.length === 0) return [{ type: 'text', value: text }];

  const nodes: HastNode[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.from > offset) {
      nodes.push({ type: 'text', value: text.slice(offset, range.from) });
    }
    nodes.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['preview-skill-token'] },
      children: [{ type: 'text', value: text.slice(range.from, range.to) }],
    });
    offset = range.to;
  }
  if (offset < text.length) {
    nodes.push({ type: 'text', value: text.slice(offset) });
  }
  return nodes;
}

function transformChildren(
  parent: HastParent,
  skillNames: ReadonlySet<string>,
  inCode: boolean,
): void {
  const nextChildren: HastNode[] = [];
  for (const child of parent.children) {
    if (isTextNode(child) && !inCode) {
      nextChildren.push(...wrapSkillTokens(child.value, skillNames));
      continue;
    }
    if (isParentNode(child)) {
      const tagName =
        typeof child.tagName === 'string' ? child.tagName.toLowerCase() : '';
      transformChildren(
        child,
        skillNames,
        inCode || tagName === 'code' || tagName === 'pre',
      );
    }
    nextChildren.push(child);
  }
  parent.children = nextChildren;
}

/**
 * Rehype-compatible plugin that wraps known skill tokens in Preview text while
 * preserving inline-code and fenced-code subtrees verbatim.
 */
export function createPreviewSkillTokenPlugin(
  skillNames: ReadonlySet<string>,
  enabled: boolean,
) {
  return () => (tree: unknown) => {
    if (!enabled || skillNames.size === 0 || !isParentNode(tree)) return;
    transformChildren(tree, skillNames, false);
  };
}
