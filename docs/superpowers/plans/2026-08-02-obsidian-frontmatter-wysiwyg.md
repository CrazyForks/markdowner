# Obsidian Front Matter WYSIWYG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render leading Obsidian YAML front matter as a collapsible Property
Card in WYSIWYG mode while preserving its original bytes unless the user edits
a specific property.

**Architecture:** A source-oriented YAML module owns leading-block detection,
CST ranges, safe display values, and minimal range patches. A custom Tiptap
atom block owns the complete raw front matter and round-trips it through the
Markdown parser and serializer. Its React node view renders a compact Property
Card; ordinary body editing never reparses or rewrites unrelated YAML.

**Tech Stack:** React 19, TypeScript, Tiptap 3 Markdown extensions, yaml 2.9.0,
Vitest, Testing Library, jsdom, Tailwind CSS

---

## Scope and Execution Order

This plan implements the front matter portion of the approved
`2026-08-01-ai-feature-document-intelligence-prd.md`. Execute it after
`2026-08-02-ai-feature-v2.md`, because translation protection and grouped
Review should already expose their final document contracts.

The repository instruction forbids subagent dispatch, so execute this plan
inline with `executing-plans`. Every task is a tested, pushed checkpoint.

## Preservation Contract

- Recognize front matter only when byte zero begins a delimiter line containing
  exactly `---` and a later line contains exactly `---` or `...`.
- Keep delimiter text, line endings, indentation, comments, quotes, key order,
  blank lines, wiki links, dates, and unknown YAML syntax byte-for-byte when
  the card is not edited.
- A body-only edit must produce `original front matter + edited body`; it must
  not serialize the YAML object back to text.
- Editing one supported property may replace only that property's source range.
  Every byte outside the target range remains equal to the loaded source.
- Duplicate keys, aliases, merge keys, block scalars, custom tags, malformed
  YAML, or any ambiguous range remain visible but use raw editing rather than a
  lossy structured control.
- The source editor remains authoritative. Switching Source → WYSIWYG → Source
  cannot silently normalize front matter.

## File Responsibility Map

### Source model

- Create `src/lib/frontMatter.ts`: leading-block split, YAML CST projection,
  supported property kinds, minimal property mutations, body projection.
- Create `src/lib/frontMatter.test.ts`: byte-preservation and mutation matrix.
- Create `tests/fixtures/obsidian-frontmatter.md`: the exact user-provided
  Obsidian clipping document.
- Modify `src/lib/documentStats.ts`: count only body content while retaining
  whole-file character behavior where explicitly expected.
- Modify `src/lib/outline.ts`: exclude YAML keys from the document outline.
- Modify `src/lib/editorDocumentState.test.ts`,
  `src/lib/documentStats.test.ts`, and `src/lib/outline.test.ts`: front matter
  projections.

### Tiptap integration

- Create `src/components/wysiwyg/frontMatterExtension.ts`: document-leading
  Markdown tokenizer, atom schema, exact raw renderer, and React node view.
- Create `src/components/wysiwyg/frontMatterExtension.test.ts`: real Markdown
  parser and serializer coverage.
- Create `src/components/wysiwyg/FrontMatterView.tsx`: collapsible Property Card
  with scalar, list, raw, invalid, and keyboard states.
- Create `src/components/wysiwyg/FrontMatterView.test.tsx`: node-view behavior.
- Modify `src/App.tsx`: register the extension ahead of Markdown and keep a
  stable extension reference.
- Modify `src/lib/wysiwygRoundtrip.integration.test.ts`: real-editor body edit
  and repeated-round-trip coverage.
- Modify `src/lib/modeCursor.ts` and `src/lib/modeCursor.integration.test.ts`:
  deterministic atom/source handoff.
- Modify `src/lib/wysiwygFind.ts` and `src/lib/wysiwygFind.test.ts`: keep
  property source out of body find results.
- Modify `src/lib/wysiwygCopy.ts` and `src/lib/wysiwygCopy.integration.test.ts`:
  serialize an explicitly selected card as its raw Markdown.
- Modify `src/lib/wysiwygPaste.ts` and
  `src/lib/wysiwygPaste.integration.test.ts`: allow one leading card without
  creating front matter atoms in the document body.
- Modify `src/styles.css`: dense Property Card styles in both themes.
- Modify `package.json` and `pnpm-lock.yaml`: add `yaml` 2.9.0 directly.

### AI document contract

- Modify `crates/markdowner-core/src/ai_document.rs`: align editable natural
  language values with exact syntax protection.
- Modify `tests/fixtures/ai/markdown-safety.json`: Obsidian clipping cases.

## Task 1: Add the lossless leading front matter source model

**Files:**

- Create: `src/lib/frontMatter.ts`
- Create: `src/lib/frontMatter.test.ts`
- Create: `tests/fixtures/obsidian-frontmatter.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the exact Obsidian fixture**

Create `tests/fixtures/obsidian-frontmatter.md` with these bytes and a final
newline:

```markdown
---
title: "AI가 코드를 짜주는 시대에, 우리는 왜 개발자를 찾을까요?"
source: "https://medium.com/algocare-career/ai%EA%B0%80-%EC%BD%94%EB%93%9C%EB%A5%BC-%EC%A7%9C%EC%A3%BC%EB%8A%94-%EC%8B%9C%EB%8C%80%EC%97%90-%EC%9A%B0%EB%A6%AC%EB%8A%94-%EC%99%9C-%EA%B0%9C%EB%B0%9C%EC%9E%90%EB%A5%BC-%EC%B0%BE%EC%9D%84%EA%B9%8C%EC%9A%94-492ed7b645aa"
author:
  - "[[Career]]"
published: 2026-07-14
created: 2026-08-01
description: "More"
tags:
  - "clippings"
---
```

- [ ] **Step 2: Write failing split, projection, and patch tests**

Define the public contract in the tests first:

```ts
export type FrontMatterPropertyKind =
  | 'string'
  | 'date'
  | 'number'
  | 'boolean'
  | 'string-list'
  | 'complex';

export interface FrontMatterProperty {
  key: string;
  kind: FrontMatterPropertyKind;
  displayValue: string | string[];
  keyRange: readonly [number, number];
  valueRange: readonly [number, number] | null;
  structuredEditable: boolean;
}

export interface FrontMatterIssue {
  message: string;
  line: number;
  column: number;
}

export interface ParsedFrontMatter {
  hasFrontMatter: boolean;
  raw: string;
  body: string;
  bodyOffset: number;
  newline: '\n' | '\r\n';
  closingMarker: '---' | '...' | null;
  valid: boolean;
  issues: readonly FrontMatterIssue[];
  properties: readonly FrontMatterProperty[];
}

export function parseLeadingFrontMatter(markdown: string): ParsedFrontMatter;
export function replaceFrontMatterProperty(
  markdown: string,
  key: string,
  nextValue: unknown,
): string;
export function addFrontMatterProperty(
  markdown: string,
  key: string,
  value: unknown,
): string;
export function deleteFrontMatterProperty(markdown: string, key: string): string;
export function markdownBody(markdown: string): string;
```

Test the fixture title, URL, dates, wiki link, and tags. Add synthetic number,
boolean, null, scalar-array, nested-map, and nested-sequence cases so every
structured/complex classification is explicit. Add exact equality assertions
for:

```ts
const parsed = parseLeadingFrontMatter(source);
expect(parsed.raw + parsed.body).toBe(source);
expect(replaceFrontMatterProperty(source, 'description', 'Expanded')).toBe(
  source.replace('description: "More"', 'description: "Expanded"'),
);
```

Add cases for CRLF, `...` closing marker, comments, quoted `---`, empty values,
duplicate keys, aliases, merge keys, block scalars, custom tags, malformed YAML,
no closing marker, a horizontal rule after body text, and a leading BOM.

- [ ] **Step 3: Run the focused test and verify RED**

```bash
pnpm exec vitest run src/lib/frontMatter.test.ts --maxWorkers=1
```

Expected: module and exports do not exist.

- [ ] **Step 4: Add yaml and implement source-range operations**

Run:

```bash
pnpm add yaml@2.9.0
```

Use `parseDocument` with source tokens and YAML 1.2 core semantics. Parse only
the payload between delimiters. Project top-level mapping pairs through CST
ranges and convert their offsets to absolute full-document offsets; never use
`document.toString()` for persistence. Convert parser positions to stable
one-based line and column issues for Raw mode.

For a supported scalar, preserve the existing quote style when safe. For a
supported sequence of scalars, replace only the value range and retain the
existing newline and indentation. Quote wiki links such as `[[Career]]`.
Adding inserts immediately before the closing marker; deleting removes the
pair's complete line range. Reject unsafe mutations with a typed
`FrontMatterMutationError` instead of returning normalized YAML.

`raw` includes the complete delimiter block and its authored line endings.
`body` begins at the first byte after that block, so `raw + body` is always the
original input.

- [ ] **Step 5: Verify the source model**

```bash
pnpm exec vitest run src/lib/frontMatter.test.ts --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
```

Expected: the preservation matrix and typecheck pass.

- [ ] **Step 6: Commit and push**

```bash
git add package.json pnpm-lock.yaml src/lib/frontMatter.ts \
  src/lib/frontMatter.test.ts tests/fixtures/obsidian-frontmatter.md
git commit -m "feat(frontmatter): add lossless Obsidian source model"
git push origin main
```

## Task 2: Round-trip front matter through a custom Tiptap atom

**Files:**

- Create: `src/components/wysiwyg/frontMatterExtension.ts`
- Create: `src/components/wysiwyg/frontMatterExtension.test.ts`
- Modify: `src/lib/wysiwygRoundtrip.integration.test.ts`

- [ ] **Step 1: Write failing real-editor round-trip tests**

Create an editor with `StarterKit`, the front matter extension, and
`Markdown.configure({ markedOptions: { gfm: true, breaks: false } })`.
Use the exact empty-body fixture first, then derive a body-edit source by
appending `\n# Article notes\n\nThe body remains editable.\n` in the test.

Test these contracts:

```ts
setMarkdown(editor, fixture);
expect(editor.state.doc.firstChild?.type.name).toBe('frontMatter');
expect(editor.state.doc.firstChild?.attrs.raw).toBe(parsed.raw);
expect(editor.getMarkdown()).toBe(fixture);

setMarkdown(editor, fixtureWithBody);
editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' edited');
expect(editor.getMarkdown().slice(0, parsed.raw.length)).toBe(parsed.raw);
```

Also test repeated parse/serialize stability, CRLF, invalid YAML, empty body,
closing `...`, body-only `---`, and that a horizontal rule in the middle is
still parsed by StarterKit rather than the front matter node.

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm exec vitest run src/components/wysiwyg/frontMatterExtension.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts --maxWorkers=1
```

Expected: the extension is missing and the fixture parses as ordinary
Markdown blocks.

- [ ] **Step 3: Implement the document-leading tokenizer and exact renderer**

Create a block atom with this shape:

```ts
export const FrontMatterExtension = Node.create({
  name: 'frontMatter',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,
  defining: true,
});
```

Add `raw`, `valid`, and `issues` attributes. Its block
`markdownTokenizer.tokenize(src, tokens)` must return a token only when
`tokens.length === 0` and the current source begins with a valid leading
delimiter block. This prevents later horizontal rules from being captured.
`parseMarkdown` creates one `frontMatter` node containing the complete raw
block. `renderMarkdown` returns the raw attribute and the exact separator
needed by the following block.

Keep parsing independent of structured validity: a closed but malformed YAML
block still becomes a lossless card with an error state. An unclosed delimiter
stays ordinary Markdown because there is no safe boundary.

- [ ] **Step 4: Verify exact serialization under real Tiptap**

```bash
pnpm exec vitest run src/components/wysiwyg/frontMatterExtension.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts --maxWorkers=1
```

Expected: all round-trips preserve the front matter prefix byte-for-byte.

- [ ] **Step 5: Commit and push**

```bash
git add src/components/wysiwyg/frontMatterExtension.ts \
  src/components/wysiwyg/frontMatterExtension.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts
git commit -m "feat(wysiwyg): round-trip front matter as an atom"
git push origin main
```

## Task 3: Render and edit the collapsible Property Card

**Files:**

- Create: `src/components/wysiwyg/FrontMatterView.tsx`
- Create: `src/components/wysiwyg/FrontMatterView.test.tsx`
- Modify: `src/components/wysiwyg/frontMatterExtension.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing Property Card interaction tests**

Render the node view through a small harness with `raw` and a mocked
`updateAttributes`. Test:

- The collapsed summary says `Properties`, shows property count, title, and tag
  summary without dumping YAML.
- The disclosure button exposes title, source, author, published, created,
  description, and tags from the fixture.
- A source URL is a safe external-link action, not an editable hyperlink over
  the entire field.
- `author` and `tags` render quoted wiki links and scalar list entries as chips.
- Editing description calls `updateAttributes` with raw text that differs only
  at the description value range.
- Add and Delete require a valid simple mapping; complex/duplicate/invalid
  documents expose `Edit raw front matter` instead.
- Escape cancels a field edit, Enter commits a single-line value, and
  Shift+Enter remains available in the raw textarea.
- Invalid YAML shows a concise error and keeps the original raw text available.
- Collapsing and reopening the card retains an in-progress field or raw draft
  without changing the node's raw source.

- [ ] **Step 2: Run the view test and verify RED**

```bash
pnpm exec vitest run src/components/wysiwyg/FrontMatterView.test.tsx --maxWorkers=1
```

Expected: Property Card component is missing.

- [ ] **Step 3: Implement the node view without nested editor mutations**

Use `NodeViewWrapper` with `contentEditable={false}` and
`ReactNodeViewRenderer(FrontMatterView)`. Default to collapsed. Put the
disclosure state in React UI state, not node attributes, so expanding the card
does not dirty the document.

Structured controls call the range-patch helpers and then only:

```ts
updateAttributes({ raw: nextRaw, ...frontMatterStatus(nextRaw) });
```

Raw mode replaces the complete atom only after parsing confirms a closing
delimiter; Cancel restores the current node attribute. Never emit YAML through
`dangerouslySetInnerHTML`. Truncate long display strings visually while keeping
the full accessible name and editable value.

Style a compact single-column card using existing background, border, text,
muted, ring, and destructive tokens. Use one disclosure icon and no decorative
gradient or badge cloud. At narrow widths, stack key and value; respect
`prefers-reduced-motion`.

- [ ] **Step 4: Verify interaction, accessibility, and typecheck**

```bash
pnpm exec vitest run src/components/wysiwyg/FrontMatterView.test.tsx \
  src/components/wysiwyg/frontMatterExtension.test.ts --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
```

Expected: interactions pass, labels are reachable by role, and TypeScript is
clean.

- [ ] **Step 5: Commit and push**

```bash
git add src/components/wysiwyg/FrontMatterView.tsx \
  src/components/wysiwyg/FrontMatterView.test.tsx \
  src/components/wysiwyg/frontMatterExtension.ts src/styles.css
git commit -m "feat(wysiwyg): add front matter Property Card"
git push origin main
```

## Task 4: Integrate application, cursor, find, copy, and paste behavior

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/lib/modeCursor.ts`
- Modify: `src/lib/modeCursor.test.ts`
- Modify: `src/lib/modeCursor.integration.test.ts`
- Modify: `src/lib/wysiwygEditorSync.test.ts`
- Modify: `src/lib/wysiwygRoundtrip.integration.test.ts`
- Modify: `src/lib/wysiwygFind.ts`
- Modify: `src/lib/wysiwygFind.test.ts`
- Modify: `src/lib/wysiwygCopy.ts`
- Modify: `src/lib/wysiwygCopy.integration.test.ts`
- Modify: `src/lib/wysiwygPaste.ts`
- Modify: `src/lib/wysiwygPaste.integration.test.ts`

- [ ] **Step 1: Add failing application and cursor tests**

Add App coverage that opens the exact fixture in WYSIWYG, finds one Properties
button, edits the body, publishes the draft, and saves source whose front matter
prefix equals the fixture. Then switch Source → WYSIWYG → Source and assert the
body cursor remains at the same Markdown offset.

Add mode cursor cases for:

- a selection on the front matter atom maps to source line 1, column 1;
- a source position inside YAML maps to the atom selection boundary;
- body positions include the serialized raw prefix and map symmetrically;
- the same cases work with CRLF and an empty body.

Add find/copy/paste cases proving property values do not appear in body find
results, a selected card copies its exact raw Markdown, whole-document copy
retains the raw prefix, and paste can create at most one card at document byte
zero. Pasting delimiter text into a body must retain ordinary Markdown behavior
and must not create a second `frontMatter` node. Assert undo/redo treats one
property edit as one transaction.

- [ ] **Step 2: Run integration tests and verify RED**

```bash
pnpm exec vitest run src/lib/modeCursor.test.ts \
  src/lib/modeCursor.integration.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts src/lib/wysiwygFind.test.ts \
  src/lib/wysiwygCopy.integration.test.ts \
  src/lib/wysiwygPaste.integration.test.ts src/App.test.tsx --maxWorkers=1
```

Expected: App does not register the node and atom cursor mapping is undefined.

- [ ] **Step 3: Register the extension and make atom mapping explicit**

Add `FrontMatterExtension` to the stable `wysiwygExtensions` array before
`Markdown`. Do not recreate the extension when the active file changes.

Teach mode cursor helpers to recognize the `frontMatter` atom. If a target
source offset is within `attrs.raw.length`, return its node boundary. When
serializing a body prefix, retain the atom's raw output, so existing binary
search remains symmetric. Keep the current source-line fallback on unexpected
serializer errors.

Do not add a special persistence side channel: the node's raw serializer must
make the existing `editor.getMarkdown()` and `resolvePersistedWysiwygMarkdown`
path correct after both body edits and property edits.

Keep the atom out of body find text. Extend the existing copy serializer only
for a NodeSelection containing `frontMatter`. Gate Markdown paste by insertion
position and existing node presence so fragment parsing cannot create a body
property card.

- [ ] **Step 4: Verify application behavior and editor regressions**

```bash
pnpm exec vitest run src/lib/modeCursor.test.ts \
  src/lib/modeCursor.integration.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts \
  src/lib/wysiwygBehavior.integration.test.ts src/lib/wysiwygFind.test.ts \
  src/lib/wysiwygCopy.integration.test.ts \
  src/lib/wysiwygPaste.integration.test.ts src/App.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
```

Expected: fixture editing and mode handoff pass without changing existing
Markdown behavior.

- [ ] **Step 5: Commit and push**

```bash
git add src/App.tsx src/App.test.tsx src/lib/modeCursor.ts \
  src/lib/modeCursor.test.ts src/lib/modeCursor.integration.test.ts \
  src/lib/wysiwygEditorSync.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts src/lib/wysiwygFind.ts \
  src/lib/wysiwygFind.test.ts src/lib/wysiwygCopy.ts \
  src/lib/wysiwygCopy.integration.test.ts src/lib/wysiwygPaste.ts \
  src/lib/wysiwygPaste.integration.test.ts
git commit -m "feat(wysiwyg): integrate lossless front matter editing"
git push origin main
```

## Task 5: Exclude properties from body-only navigation and statistics

**Files:**

- Modify: `src/lib/documentStats.ts`
- Modify: `src/lib/documentStats.test.ts`
- Modify: `src/lib/outline.ts`
- Modify: `src/lib/outline.test.ts`
- Modify: `src/lib/editorDocumentState.test.ts`

- [ ] **Step 1: Write failing body-projection tests**

For the exact empty-body fixture, assert outline is empty and every document
stat is zero. For the derived fixture with `# Article notes`, assert outline
contains only `Article notes`. Assert words, characters, headings, links,
images, tables, and reading time are all derived from the body rather than YAML
values.

Add a malformed-but-closed YAML case and assert it still projects the body.
Add an unclosed delimiter case and assert the full Markdown remains visible to
both parsers because it is not recognized front matter.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm exec vitest run src/lib/documentStats.test.ts src/lib/outline.test.ts \
  src/lib/editorDocumentState.test.ts --maxWorkers=1
```

Expected: YAML keys or values inflate body-only output.

- [ ] **Step 3: Reuse one source projection**

Call `markdownBody` from both `calculateDocumentStats` and
`parseMarkdownOutline`; do not create competing delimiter regexes. Keep outline
selection offsets in full-document coordinates by adding `bodyOffset` to each
body heading range before returning it.

- [ ] **Step 4: Verify projections and navigation offsets**

```bash
pnpm exec vitest run src/lib/documentStats.test.ts src/lib/outline.test.ts \
  src/lib/outlineNavigation.test.ts src/lib/editorDocumentState.test.ts \
  --maxWorkers=1
```

Expected: body-only counts and full-document outline navigation both pass.

- [ ] **Step 5: Commit and push**

```bash
git add src/lib/documentStats.ts src/lib/documentStats.test.ts \
  src/lib/outline.ts src/lib/outline.test.ts \
  src/lib/editorDocumentState.test.ts
git commit -m "fix(frontmatter): exclude properties from body indexes"
git push origin main
```

## Task 6: Align AI protection with Obsidian property semantics

**Files:**

- Modify: `crates/markdowner-core/src/ai_document.rs`
- Modify: `tests/fixtures/ai/markdown-safety.json`

- [ ] **Step 1: Add failing clipping translation tests**

Use the exact fixture to prove translation protection keeps delimiters, keys,
source URL, ISO dates, wiki-link syntax, and tag identifiers unchanged. Permit
natural-language values for `title` and `description` to be translated through
explicit value placeholders without allowing the model to change quoting,
keys, or structure.

Add a PRD/custom case proving the entire raw front matter remains protected.
Add duplicate-key, block-scalar, and invalid YAML cases that fall back to full
front matter protection.

- [ ] **Step 2: Run core tests and verify RED**

```bash
cargo test -p markdowner-core ai_document -- --nocapture
```

Expected: current all-or-nothing protection cannot express the approved
natural-language value policy.

- [ ] **Step 3: Implement allowlisted value placeholders**

Parse only a valid simple top-level mapping. For translation, protect the whole
front matter first, then expose only allowlisted scalar values such as `title`
and `description` as separately validated translation segments. Reassemble by
source range, retaining every byte outside those values. Do not translate URL,
date, author, tag, wiki-link, key, delimiter, comment, anchor, alias, or custom
tag syntax.

Use full-block protection on ambiguity. Validate that placeholder count and
order match before merge.

- [ ] **Step 4: Verify AI and frontend preservation together**

```bash
cargo test -p markdowner-core ai_document -- --nocapture
pnpm exec vitest run src/lib/frontMatter.test.ts \
  src/components/wysiwyg/frontMatterExtension.test.ts --maxWorkers=1
```

Expected: translation policy and byte-preserving WYSIWYG tests pass.

- [ ] **Step 5: Commit and push**

```bash
git add crates/markdowner-core/src/ai_document.rs \
  tests/fixtures/ai/markdown-safety.json
git commit -m "feat(ai-translation): preserve Obsidian property syntax"
git push origin main
```

## Task 7: Complete the front matter quality gate

**Files:**

- Modify: relevant files above only when a failing gate identifies a defect

- [ ] **Step 1: Run focused front matter suites**

```bash
pnpm exec vitest run src/lib/frontMatter.test.ts \
  src/components/wysiwyg/FrontMatterView.test.tsx \
  src/components/wysiwyg/frontMatterExtension.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts \
  src/lib/modeCursor.integration.test.ts src/lib/wysiwygFind.test.ts \
  src/lib/wysiwygCopy.integration.test.ts \
  src/lib/wysiwygPaste.integration.test.ts src/lib/documentStats.test.ts \
  src/lib/outline.test.ts src/App.test.tsx --maxWorkers=1
```

Expected: all tests exit 0 using the exact Obsidian fixture.

- [ ] **Step 2: Run repository regression gates**

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace -- --nocapture
pnpm test
pnpm exec tsc --noEmit --pretty false
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 3: Perform installed-app manual proof**

Build and launch the current macOS artifact. Open
`tests/fixtures/obsidian-frontmatter.md`, enter WYSIWYG, expand Properties,
edit body text and one supported property, save, switch modes, close, and
reopen. Compare the saved file against the expected target and verify all
unmodified front matter bytes are identical.

Also inspect compact/narrow layouts, light/dark themes, keyboard focus,
VoiceOver labels, invalid YAML raw fallback, source URL opening, and undo/redo
for a property edit. State plainly if TCC or device automation prevents any
part of this proof.

- [ ] **Step 4: Commit only fixes, then push and prove parity**

```bash
git status --short
git diff --check
git push origin main
git fetch origin
git rev-list --left-right --count HEAD...@{u}
```

If a failing gate required fixes, explicitly stage only those modified paths,
commit them as `test(frontmatter): close WYSIWYG preservation gates`, and push.
Skip the commit when no fixes were needed. Expected final parity is `0 0` and
the worktree is clean.

## Task 8: Publish the Headatever patch release

**Files:**

- Modify through Headatever: `VERSION`
- Synchronize after the tagged bump: `package.json`
- Synchronize after the tagged bump: `src-tauri/tauri.conf.json`
- Synchronize after the tagged bump: `src-tauri/Cargo.toml`
- Synchronize after the tagged bump: `Cargo.lock`

- [ ] **Step 1: Prove the release preconditions**

```bash
git status --short --branch
git fetch origin
git rev-list --left-right --count HEAD...@{u}
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --dry-run
```

Expected: `main`, clean worktree, parity `0 0`, and a unique date-based patch
version preview. Do not release from a dirty or divergent checkout.

- [ ] **Step 2: Create, tag, and push the version commit with Headatever**

```bash
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --push
```

Expected: Headatever changes only `VERSION`, creates a release commit and its
annotated version tag, then uses `git push --follow-tags`.

- [ ] **Step 3: Synchronize repository version metadata**

```bash
pnpm sync-version
pnpm sync-version --check
git diff --check
git status --short
```

Explicitly stage only `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and `Cargo.lock`. Read `VERSION` into a task-specific
`release_version` shell variable, commit with the repository's established
`chore(release): sync v... metadata` form, and push `main`.

- [ ] **Step 4: Verify the versioned local artifact and remote publication**

```bash
release_version=$(tr -d '[:space:]' < VERSION)
pnpm build install
pnpm sync-version --check
defaults read /Applications/Markdowner.app/Contents/Info.plist \
  CFBundleShortVersionString
git fetch origin --tags
git tag -n99 "v${release_version}"
git ls-remote --exit-code --tags origin \
  "refs/tags/v${release_version}"
gh run list --workflow Release --branch main --limit 5
gh release view "v${release_version}" --json tagName,assets,url
git rev-list --left-right --count HEAD...@{u}
git status --short
```

Assert the installed app version equals `VERSION`, the annotated tag resolves
to the Headatever version commit, and the tag is present remotely. Monitor the
matching GitHub Actions release run to a terminal result and verify the
versioned DMG asset before claiming publication. State plainly if GitHub, TCC,
or local installation access prevents any proof.

Expected: installed version matches, the workflow succeeds with a DMG asset,
the worktree is clean, and branch parity is `0 0`.

## Plan Self-Review

- Spec coverage: the exact clipping fixture, collapsible Property Card,
  structured and raw modes, invalid YAML, body editing, mode handoff, AI
  translation safety, statistics, outline, themes, accessibility, installed
  artifact proof, byte preservation, and the Headatever patch release each map
  to a task above.
- Preservation proof: tests compare complete byte slices, not parsed YAML
  equality. All structured edits use CST ranges and all ambiguity fails closed
  into raw/full-block handling.
- Type consistency: `ParsedFrontMatter`, `FrontMatterProperty`, the Tiptap
  `frontMatter` attributes, and AI value placeholders each have a single owner
  before cross-layer use.
- No unresolved implementation placeholders remain. Conditional release-gate
  fixes require explicit path staging after the actual paths are known.
