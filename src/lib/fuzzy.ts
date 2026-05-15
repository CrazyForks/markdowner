/**
 * VS Code-style fuzzy matcher.
 *
 * Returns a positive score if every character of `query` appears in `haystack`
 * in order (not necessarily consecutively); higher scores reflect tighter,
 * earlier, and more contiguous matches. Returns 0 when there is no match.
 *
 * Matching is case-insensitive and ASCII-only on the query side — callers are
 * expected to strip non-ASCII characters from user input before calling.
 */
export function fuzzyScore(haystack: string, query: string): number {
  if (query.length === 0) return 1;
  if (haystack.length === 0) return 0;

  const hay = haystack.toLowerCase();
  // Whitespace is treated as a "wildcard" separator: it's stripped from the
  // needle so "api md" still fuzzily matches paths like "guides/api.md".
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (needle.length === 0) return 1;

  let score = 0;
  let hayIndex = 0;
  let consecutive = 0;
  let prevMatchIndex = -1;

  for (let q = 0; q < needle.length; q++) {
    const ch = needle.charCodeAt(q);
    let found = -1;
    while (hayIndex < hay.length) {
      if (hay.charCodeAt(hayIndex) === ch) {
        found = hayIndex;
        hayIndex++;
        break;
      }
      hayIndex++;
    }
    if (found === -1) return 0;

    // Base score: 1 per matched character.
    let bonus = 1;
    // Reward consecutive matches.
    if (prevMatchIndex >= 0 && found === prevMatchIndex + 1) {
      consecutive++;
      bonus += consecutive * 2;
    } else {
      consecutive = 0;
    }
    // Reward matches at start of string or after a word boundary.
    if (found === 0) {
      bonus += 4;
    } else {
      const prev = haystack.charCodeAt(found - 1);
      // Word boundary: separator, slash, dot, dash, or camelCase boundary.
      const isWordBoundary =
        prev === 0x20 /* space */ ||
        prev === 0x2d /* - */ ||
        prev === 0x5f /* _ */ ||
        prev === 0x2e /* . */ ||
        prev === 0x2f /* / */ ||
        prev === 0x5c /* \ */ ||
        prev === 0x3a /* : */;
      const isCamelBoundary =
        haystack.charCodeAt(found) >= 0x41 &&
        haystack.charCodeAt(found) <= 0x5a; // uppercase
      if (isWordBoundary || isCamelBoundary) {
        bonus += 2;
      }
    }
    score += bonus;
    prevMatchIndex = found;
  }

  // Slightly prefer shorter haystacks for ties.
  return score + Math.max(0, 4 - Math.floor(haystack.length / 16));
}

/**
 * Strip non-ASCII letters/digits and common punctuation from user input.
 * Used by the Command Palette to enforce English-only input regardless of
 * the active OS IME — Korean Hangul, CJK, accented Latin etc. are filtered.
 */
export function stripToAscii(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      out += input[i];
    }
  }
  return out;
}
