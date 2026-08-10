import type { ResolvedPos } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import type { LocalAgentKind } from "./types";

export const LOCAL_AGENT_MENTIONS = [
  { kind: "claude", mention: "@claude", label: "Claude Code" },
  { kind: "codex", mention: "@codex", label: "Codex" },
  { kind: "opencode", mention: "@opencode", label: "OpenCode" },
] as const satisfies ReadonlyArray<{
  kind: LocalAgentKind;
  mention: `@${string}`;
  label: string;
}>;

export function filterLocalAgentMentions(query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return LOCAL_AGENT_MENTIONS.filter((agent) =>
    agent.mention.toLocaleLowerCase().startsWith(normalized),
  );
}

const SAFE_TEXTBLOCKS = new Set(["paragraph", "heading"]);
const UNSAFE_NODE_NAMES = new Set([
  "codeBlock",
  "frontMatter",
  "front_matter",
  "yaml",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

/**
 * Returns the no-op replacement range for an @ mention only in a narrow,
 * text-only ProseMirror context. Callers must prevent the original key event.
 */
export function isEligibleLocalAgentMentionKey(
  view: Pick<EditorView, "state"> & { composing?: boolean },
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "isComposing"
  >,
): { from: number; to: number } | null {
  if (
    event.key === "Process" ||
    event.key !== "@" ||
    event.isComposing ||
    view.composing === true ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return null;
  }

  const selection = view.state?.selection;
  const $from = selection?.$from;
  const $to = selection?.$to;
  if (
    !selection ||
    !Number.isInteger(selection.from) ||
    !Number.isInteger(selection.to) ||
    selection.from > selection.to ||
    !$from ||
    !$to
  )
    return null;
  if (selection.constructor?.name === "CellSelection") return null;
  if (
    !isSafeTextPosition($from) ||
    !isSafeTextPosition($to)
  ) {
    return null;
  }

  const position = selection.from;
  const range = { from: position, to: selection.to };
  if ($from.parentOffset === 0 || position <= 1) return range;
  const preceding = view.state.doc.textBetween(position - 1, position);
  return /\s/u.test(preceding) ? range : null;
}

function isSafeTextPosition(position: ResolvedPos): boolean {
  return (
    SAFE_TEXTBLOCKS.has(position.parent.type.name) &&
    position.parent.isTextblock !== false &&
    !hasUnsafeAncestor(position) &&
    !position.marks?.().some((mark) => mark.type.name === "code")
  );
}

function hasUnsafeAncestor($from: ResolvedPos): boolean {
  for (let depth = 0; depth <= $from.depth; depth += 1) {
    if (UNSAFE_NODE_NAMES.has($from.node(depth).type.name)) return true;
  }
  return false;
}
