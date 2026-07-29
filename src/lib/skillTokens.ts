import { invoke } from '@tauri-apps/api/core';

export type SkillTokenRange = { from: number; to: number };

// Boundary rules keep prose like "path/goal", "DELETE /api/users", and
// quoted `` `/goal` `` unhighlighted: the sigil must open a word (start,
// whitespace, or an opening bracket/quote before it) and the token must
// close one (end, whitespace, or closing punctuation after it). Membership
// in the scanned skill-name set is the final filter.
const BEFORE_BOUNDARY = /[\s([{'"«‘“]/;
const AFTER_BOUNDARY = /[\s.,;:!?)\]}'"»’”]/;

/**
 * Finds `/name` and `$name` skill tokens in plain text. Name segments use
 * the same charset the Rust registry accepts (`[A-Za-z0-9_-]`, one optional
 * `:` namespace separator, e.g. `superpowers:brainstorming`).
 */
export function findSkillTokenRanges(
  text: string,
  skillNames: ReadonlySet<string>,
): SkillTokenRange[] {
  if (skillNames.size === 0 || text.length === 0) return [];
  const pattern = /[/$]([A-Za-z0-9][A-Za-z0-9_-]*(?::[A-Za-z0-9][A-Za-z0-9_-]*)?)/g;
  const ranges: SkillTokenRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const before = text[match.index - 1];
    const after = text[match.index + match[0].length];
    if (before !== undefined && !BEFORE_BOUNDARY.test(before)) continue;
    if (after !== undefined && !AFTER_BOUNDARY.test(after)) continue;
    if (!skillNames.has(match[1])) continue;
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

/**
 * Markdown-aware variant for the source editor: tokens inside fenced code
 * blocks and inline backtick spans are excluded, since those regions already
 * read as code. Line-based like the rest of the source-editor helpers.
 */
export function findSkillTokenRangesInMarkdown(
  text: string,
  skillNames: ReadonlySet<string>,
): SkillTokenRange[] {
  if (skillNames.size === 0 || text.length === 0) return [];
  const ranges: SkillTokenRange[] = [];
  let offset = 0;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^(```|~~~)/.test(line.trimStart())) {
      inFence = !inFence;
    } else if (!inFence) {
      for (const range of findSkillTokenRanges(line, skillNames)) {
        if (isInsideInlineCode(line, range.from)) continue;
        ranges.push({ from: offset + range.from, to: offset + range.to });
      }
    }
    offset += line.length + 1;
  }
  return ranges;
}

/** Odd number of backticks before the index means we are inside a span. */
function isInsideInlineCode(line: string, index: number): boolean {
  let backticks = 0;
  for (let i = 0; i < index; i += 1) {
    if (line[i] === '`') backticks += 1;
  }
  return backticks % 2 === 1;
}

/**
 * Skill token names from the Rust registry scan (Claude Code / Codex
 * built-ins plus everything installed under ~/.claude, ~/.agents, ~/.codex).
 * Returns [] when the backend isn't reachable (tests, web preview) so the
 * highlight feature stays inert instead of erroring.
 */
export async function loadSkillTokenNames(): Promise<string[]> {
  try {
    const result = await invoke<unknown>('list_skill_names');
    if (!Array.isArray(result)) return [];
    return result.filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    );
  } catch (error) {
    console.error('Failed to load skill token names:', error);
    return [];
  }
}
