# H1-H4 Heading Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make H1-H4 the complete WYSIWYG heading-authoring surface and render the four levels consistently through preview, HTML export, and PDF export while preserving existing H5/H6 Markdown losslessly.

**Architecture:** Introduce one focused Tiptap heading extension whose schema keeps H1-H6 compatibility but whose input rules and shortcuts create only H1-H4. Reuse its authoring-level constants in the WYSIWYG menus, then align the existing semantic heading CSS across editable, preview, and export surfaces without adding another Markdown or PDF rendering path.

**Tech Stack:** React 19, TypeScript 5.8, Tiptap 3, ProseMirror input rules, React-Markdown 9, Tailwind CSS 4, Vitest 4, Tauri 2, Rust/Cargo, Headatever

## Global Constraints

- H1-H4 are the supported authoring levels.
- Existing H5/H6 documents must remain readable, navigable, and serializable without rewriting their levels.
- Source mode and Outline continue to accept and expose H1-H6.
- WYSIWYG input rules, heading shortcuts, slash insertion, and `Cmd+/` conversion create only H1-H4.
- H1-H4 use the approved relative sizes: `1.875em`, `1.5em`, `1.25em`, and `1.125em`.
- The existing first-block H1 page-title treatment remains unchanged.
- HTML and PDF share `buildExportHtml()`; no second export parser or PDF-only heading renderer is allowed.
- Imported custom themes retain their existing scoped override behavior.
- Only explicit task paths may be staged. Ordinary pushes and annotated tags must never rewrite remote history.

---

## File Structure

- Create `src/components/wysiwyg/headingExtension.ts` to own compatibility levels, authoring levels, input rules, and heading keyboard shortcuts.
- Create `src/components/wysiwyg/headingExtension.test.ts` to prove H1-H4 creation, H5/H6 input refusal, shortcut limits, and H1-H6 round-trip compatibility with the real Tiptap Markdown stack.
- Modify `src/App.tsx` and `src/editorPlayground.tsx` to replace StarterKit's stock heading extension with the shared Markdowner extension.
- Modify `src/components/wysiwyg/SlashCommandMenu.tsx` and its test to generate exactly H1-H4 menu actions from the shared authoring levels.
- Modify `src/lib/wysiwygBehavior.integration.test.ts` and `src/lib/wysiwygRoundtrip.integration.test.ts` so production-shaped integration harnesses use the same heading extension and lock H4/H5/H6 behavior.
- Modify `src/lib/outline.test.ts` to prove preserved H5/H6 headings remain navigable at their original depths.
- Modify `src/styles.css` and verify its built output through browser-computed styles in base preview, split preview, and ProseMirror.
- Modify `src/shell/MarkdownPreviewPane.test.tsx` to prove semantic H1-H4 preview output and source-line metadata.
- Modify `src/lib/exportDocument.ts` and `src/lib/exportDocument.test.ts` to define and verify the self-contained HTML/PDF heading scale and rhythm.
- Modify `package.json` and `pnpm-lock.yaml` to make `@tiptap/extension-heading` a direct dependency rather than importing an undeclared StarterKit transitive dependency.
- Modify `VERSION`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock` only during the final release task.

### Task 1: Implement the H1-H4 authoring and H1-H6 compatibility contract

**Files:**
- Create: `src/components/wysiwyg/headingExtension.ts`
- Create: `src/components/wysiwyg/headingExtension.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/editorPlayground.tsx`
- Modify: `src/components/wysiwyg/SlashCommandMenu.tsx`
- Modify: `src/components/wysiwyg/SlashCommandMenu.test.tsx`
- Modify: `src/lib/wysiwygBehavior.integration.test.ts`
- Modify: `src/lib/wysiwygRoundtrip.integration.test.ts`
- Modify: `src/lib/outline.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `COMPATIBILITY_HEADING_LEVELS: readonly [1, 2, 3, 4, 5, 6]`
- Produces: `AUTHORING_HEADING_LEVELS: readonly [1, 2, 3, 4]`
- Produces: `AuthoringHeadingLevel`, the union `1 | 2 | 3 | 4`
- Produces: `MarkdownerHeading`, a Tiptap node extension named `heading`
- Consumes: `Heading` from `@tiptap/extension-heading` and `textblockTypeInputRule` from `@tiptap/core`

- [ ] **Step 1: Add the direct heading dependency**

Run:

```bash
pnpm add @tiptap/extension-heading@^3.4.1
```

Expected: `package.json` lists `@tiptap/extension-heading` beside the other Tiptap extensions and `pnpm-lock.yaml` records the resolved package without removing unrelated overrides.

- [ ] **Step 2: Write the failing heading-extension tests**

Create `src/components/wysiwyg/headingExtension.test.ts` with a real editor harness:

```ts
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AUTHORING_HEADING_LEVELS,
  COMPATIBILITY_HEADING_LEVELS,
  MarkdownerHeading,
} from './headingExtension';

function buildEditor(content = ''): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: false }),
      MarkdownerHeading,
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content,
    contentType: content ? 'markdown' : undefined,
  });
}

function typeText(editor: Editor, text: string): void {
  for (const character of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handled = view.someProp('handleTextInput', (handler: any) =>
      handler(view, from, to, character),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

describe('MarkdownerHeading', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('declares H1-H4 authoring and H1-H6 compatibility levels', () => {
    expect(AUTHORING_HEADING_LEVELS).toEqual([1, 2, 3, 4]);
    expect(COMPATIBILITY_HEADING_LEVELS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each([
    ['# ', 1],
    ['## ', 2],
    ['### ', 3],
    ['#### ', 4],
  ] as const)('converts %s to H%s', (prefix, level) => {
    editor = buildEditor();
    typeText(editor, prefix);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level },
    });
  });

  it.each(['##### ', '###### '] as const)('leaves %s as paragraph text', (prefix) => {
    editor = buildEditor();
    typeText(editor, prefix);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: prefix }],
    });
  });

  it('provides H4 but not H5 keyboard conversion', () => {
    editor = buildEditor();
    expect(editor.commands.keyboardShortcut('Mod-Alt-4')).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 4 },
    });

    editor.destroy();
    editor = buildEditor();
    expect(editor.commands.keyboardShortcut('Mod-Alt-5')).toBe(false);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'paragraph' });
  });

  it('round-trips existing H1-H6 without changing their depths', () => {
    editor = buildEditor(
      ['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six'].join('\n\n'),
    );
    expect(editor.getMarkdown().trim()).toBe(
      ['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six'].join('\n\n'),
    );
  });
});
```

- [ ] **Step 3: Run the new test and verify it fails for the missing module**

Run:

```bash
pnpm exec vitest run src/components/wysiwyg/headingExtension.test.ts --maxWorkers=1
```

Expected: FAIL because `./headingExtension` does not exist.

- [ ] **Step 4: Implement the restricted authoring extension**

Create `src/components/wysiwyg/headingExtension.ts`:

```ts
import { textblockTypeInputRule } from '@tiptap/core';
import Heading, { type Level } from '@tiptap/extension-heading';

export const COMPATIBILITY_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const satisfies readonly Level[];
export const AUTHORING_HEADING_LEVELS = [1, 2, 3, 4] as const satisfies readonly Level[];
export type AuthoringHeadingLevel = (typeof AUTHORING_HEADING_LEVELS)[number];

export const MarkdownerHeading = Heading.extend({
  addKeyboardShortcuts() {
    return AUTHORING_HEADING_LEVELS.reduce<Record<string, () => boolean>>(
      (shortcuts, level) => {
        shortcuts[`Mod-Alt-${level}`] = () =>
          this.editor.commands.toggleHeading({ level });
        return shortcuts;
      },
      {},
    );
  },

  addInputRules() {
    return AUTHORING_HEADING_LEVELS.map((level) =>
      textblockTypeInputRule({
        find: new RegExp(`^(#{${level}})\\s$`),
        type: this.type,
        getAttributes: { level },
      }),
    );
  },
}).configure({ levels: [...COMPATIBILITY_HEADING_LEVELS] });
```

- [ ] **Step 5: Replace StarterKit's stock heading in production and playground editors**

In both `src/App.tsx` and `src/editorPlayground.tsx`, import `MarkdownerHeading`, set `heading: false` in `StarterKit.configure(...)`, and insert `MarkdownerHeading` immediately after StarterKit:

```ts
StarterKit.configure({
  heading: false,
  link: WYSIWYG_LINK_OPTIONS,
  codeBlock: false,
}),
MarkdownerHeading,
```

Keep the production extension array memoized and preserve its existing order for all non-heading extensions.

- [ ] **Step 6: Restrict slash and Turn into menus to the shared authoring levels**

In `src/components/wysiwyg/SlashCommandMenu.tsx`, remove `Heading5`, build the four heading items from `AUTHORING_HEADING_LEVELS`, and retain the existing descriptions and Korean aliases:

```ts
const HEADING_ICONS: Record<AuthoringHeadingLevel, typeof Type> = {
  1: Heading1,
  2: Heading2,
  3: Heading3,
  4: Heading4,
};

const HEADING_DESCRIPTIONS: Record<AuthoringHeadingLevel, string> = {
  1: 'Large section heading.',
  2: 'Medium section heading.',
  3: 'Small section heading.',
  4: 'Sub-section heading.',
};

const HEADING_ITEMS: SlashItem[] = AUTHORING_HEADING_LEVELS.map((level) => ({
  id: `h${level}`,
  title: `Heading ${level}`,
  description: HEADING_DESCRIPTIONS[level],
  keywords: [
    `h${level}`,
    'heading',
    ...(level === 1 ? ['title', '큰제목'] : []),
    `제목${level}`,
    '제목',
    '헤딩',
  ],
  icon: HEADING_ICONS[level],
  convertible: true,
  run: (editor) => editor.chain().focus().setNode('heading', { level }).run(),
}));
```

Spread `HEADING_ITEMS` between the existing Text item and Bulleted list item. Preserve `title` and `큰제목` as H1-only aliases exactly as shown.

- [ ] **Step 7: Update menu and production-shaped integration tests**

In `src/components/wysiwyg/SlashCommandMenu.test.tsx`, replace the H1-H5 assertion with:

```ts
for (const level of [1, 2, 3, 4]) {
  expect(screen.getByRole('menuitem', { name: new RegExp(`heading ${level}`, 'i') })).toBeInTheDocument();
}
expect(screen.queryByRole('menuitem', { name: /heading 5/i })).toBeNull();
```

Keep the existing `h4` filter and selection-preservation assertions. In both WYSIWYG integration harnesses, set StarterKit `heading: false`, add `MarkdownerHeading`, add the H4 input-rule case, add H5/H6 literal-input cases, and add an H1-H6 Markdown round-trip case. Add this compatibility assertion to `src/lib/outline.test.ts`:

```ts
it('keeps compatibility H5/H6 headings navigable at their source depth', () => {
  expect(
    parseMarkdownOutline('##### Five\n###### Six').map(({ depth, title }) => ({ depth, title })),
  ).toEqual([
    { depth: 5, title: 'Five' },
    { depth: 6, title: 'Six' },
  ]);
});
```

- [ ] **Step 8: Run the authoring contract tests**

Run:

```bash
pnpm exec vitest run \
  src/components/wysiwyg/headingExtension.test.ts \
  src/components/wysiwyg/SlashCommandMenu.test.tsx \
  src/lib/wysiwygBehavior.integration.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts \
  src/lib/outline.test.ts \
  --maxWorkers=1
```

Expected: all five files pass; H4 is creatable, Heading 5 is absent from menus, typed H5/H6 remains paragraph text, existing H5/H6 source round-trips, and Outline preserves depths 5 and 6.

### Task 2: Align heading typography across WYSIWYG, preview, HTML, and PDF

**Files:**
- Modify: `src/styles.css`
- Modify: `src/shell/MarkdownPreviewPane.test.tsx`
- Modify: `src/lib/exportDocument.ts`
- Modify: `src/lib/exportDocument.test.ts`

**Interfaces:**
- Consumes: semantic `h1` through `h6` nodes emitted by the existing Tiptap and React-Markdown renderers
- Produces: base, split-preview, ProseMirror, and `.markdowner-export` H1-H4 rules using the approved scale
- Produces: quiet body-sized H5/H6 compatibility rules

- [ ] **Step 1: Establish a failing rendered-style baseline**

Start `pnpm dev --host 127.0.0.1`, open `/playground.html` with the `agent-browser` skill, and author H1-H4 followed by body text. Evaluate `getComputedStyle()` for each heading and its following paragraph. Record the current H4 result under `/tmp/markdowner-heading-qa/red-computed-styles.json`.

Expected before implementation: H4 has the browser/body-sized fallback instead of the approved `1.125` ratio and compact subsection rhythm. This is the failing behavior; do not accept a source-text search as a substitute.

- [ ] **Step 2: Write failing preview and export tests**

Add a preview test that renders all four supported levels:

```tsx
const { container } = render(
  <MarkdownPreviewPane
    source={['# One', '## Two', '### Three', '#### Four'].join('\n\n')}
  />,
);
for (const level of [1, 2, 3, 4]) {
  const heading = container.querySelector(`h${level}`);
  expect(heading).toHaveAttribute('data-source-line');
}
```

Add a `buildExportHtml` test using the same four-level source and assert:

```ts
for (const level of [1, 2, 3, 4]) {
  expect(html).toContain(`<h${level}`);
}
expect(html).toContain('.markdowner-export h1 { font-size: 1.875em;');
expect(html).toContain('.markdowner-export h2 { font-size: 1.5em;');
expect(html).toContain('.markdowner-export h3 { font-size: 1.25em;');
expect(html).toContain('.markdowner-export h4 { font-size: 1.125em;');
```

Run the DOM/export tests:

```bash
pnpm exec vitest run src/shell/MarkdownPreviewPane.test.tsx src/lib/exportDocument.test.ts --maxWorkers=1
```

Expected: the new semantic preview assertion passes because React-Markdown already emits H4, while the export assertion fails because export H1 still uses `2em`. The browser baseline from Step 1 independently proves the missing WYSIWYG/preview H4 presentation.

- [ ] **Step 3: Add the base and compatibility heading rules**

In `src/styles.css`, replace the fixed Tailwind text-size utilities on H1-H3 with the approved relative values and add H4-H6:

```css
.markdown-surface h1 {
  font-size: 1.875em;
  @apply mt-6 mb-4 font-bold leading-tight;
}
.markdown-surface h2 {
  font-size: 1.5em;
  @apply mt-6 mb-3 font-semibold leading-snug;
}
.markdown-surface h3 {
  font-size: 1.25em;
  @apply mt-5 mb-2 font-semibold;
}
.markdown-surface h4 {
  font-size: 1.125em;
  @apply mt-4 mb-2 font-semibold leading-snug;
}
.markdown-surface h5,
.markdown-surface h6 {
  font-size: 1em;
  @apply mt-4 mb-2 font-semibold;
}
```

The existing `ruleBody()` helper matches each selector in the comma-separated H5/H6 rule. Keep H5/H6 visually quiet and do not add them to any authoring menu.

- [ ] **Step 4: Add split-preview and ProseMirror parity rules**

Add `1.125em`, semibold, compact `mt-4 mb-2` rules for both surfaces:

```css
.editor-pane-preview .markdown-surface h4 {
  font-size: 1.125em;
  @apply mt-4 mb-2 font-semibold leading-snug;
}
.notion-editor-content .ProseMirror h4 {
  font-size: 1.125em;
  @apply mt-4 mb-2 px-1 font-semibold tracking-normal;
}
```

Add H5/H6 compatibility rules at `1em` with `mt-4 mb-2 font-semibold` in split preview and `mt-4 mb-2 px-1 font-semibold tracking-normal` in ProseMirror. Retain the existing H1-H3 `mt-6 mb-2` rhythm and the first-child H1 `2.35em` page-title override.

- [ ] **Step 5: Align the self-contained export style block**

In `src/lib/exportDocument.ts`, replace the heading-size fragment with explicit approved sizes and weights:

```css
.markdowner-export h1 { font-size: 1.875em; font-weight: 700; }
.markdowner-export h2 { font-size: 1.5em; font-weight: 600; }
.markdowner-export h3 { font-size: 1.25em; font-weight: 600; }
.markdowner-export h4 { font-size: 1.125em; font-weight: 600; }
.markdowner-export h5, .markdowner-export h6 { font-size: 1em; font-weight: 600; }
.markdowner-export h1,
.markdowner-export h2,
.markdowner-export h3 { margin-block: 1.5em 0.5em; }
.markdowner-export h4,
.markdowner-export h5,
.markdowner-export h6 { margin-block: 1em 0.5em; }
```

These declarations must remain inside `styleCss`, which is embedded in both standalone HTML and the HTML sent to the native PDF exporter.

- [ ] **Step 6: Run the complete focused heading suite**

Run:

```bash
pnpm exec vitest run \
  src/components/wysiwyg/headingExtension.test.ts \
  src/components/wysiwyg/SlashCommandMenu.test.tsx \
  src/lib/wysiwygBehavior.integration.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts \
  src/lib/outline.test.ts \
  src/shell/MarkdownPreviewPane.test.tsx \
  src/lib/exportDocument.test.ts \
  src/lib/pdfPagination.production.test.ts \
  --maxWorkers=1
```

Expected: all tests pass, including the production/minified pagination harness. Repeat the Step 1 browser `getComputedStyle()` evaluation and store `/tmp/markdowner-heading-qa/green-computed-styles.json`; H1-H4 ratios must be `1.875`, `1.5`, `1.25`, and `1.125` relative to body text, H4 must have `font-weight: 600`, and H5/H6 compatibility headings must remain at the body-size ratio `1`.

### Task 3: Verify, review, commit, and push the feature checkpoint

**Files:**
- Review: every source and test path changed by Tasks 1-2
- No new production files beyond the paths declared above

**Interfaces:**
- Consumes: the completed H1-H4 implementation and focused tests
- Produces: pushed Conventional Commit `feat(editor): support h1-h4 heading hierarchy`

- [ ] **Step 1: Run static and full repository gates**

Run in order:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm build
git diff --check
```

Expected: TypeScript passes, the serial Vitest plus shell test suite passes, the production build succeeds, and `git diff --check` prints nothing.

- [ ] **Step 2: Run browser playground QA in both themes**

Start the dev server and note Vite's actual announced port:

```bash
pnpm dev --host 127.0.0.1
```

Using the `agent-browser` skill, open `/playground.html`, create H1-H4 with hash-space input and the slash menu, and verify:

- H1-H4 are visibly distinct and H4 remains stronger than body text.
- Heading 5 does not appear in Insert block or Turn into.
- H4 search and selection work by keyboard and pointer.
- The first H1 retains the page-title treatment.
- Light and dark themes remain readable at desktop width and a narrow responsive width.

Capture screenshots under `/tmp/markdowner-heading-qa/` for evidence without adding them to Git.

- [ ] **Step 3: Verify generated HTML and a native PDF artifact**

Create `/tmp/markdowner-heading-qa/heading-levels.md` containing H1-H4 plus body paragraphs, open it in the installed application, and export to `/tmp/markdowner-heading-qa/heading-levels.html` and `/tmp/markdowner-heading-qa/heading-levels.pdf`. Prove the HTML contains semantic `h1`-`h4` and the approved embedded CSS. Verify the PDF is non-empty and structurally valid with:

```bash
pdfinfo /tmp/markdowner-heading-qa/heading-levels.pdf
```

If `pdfinfo` is unavailable, use the macOS metadata and preview path:

```bash
mdls -name kMDItemNumberOfPages -name kMDItemFSSize /tmp/markdowner-heading-qa/heading-levels.pdf
```

Expected: at least one page, a positive file size, and no native exporter error.

- [ ] **Step 4: Review and stage only feature paths**

Run:

```bash
git status --short
git diff -- package.json pnpm-lock.yaml src/App.tsx src/editorPlayground.tsx \
  src/components/wysiwyg/headingExtension.ts \
  src/components/wysiwyg/headingExtension.test.ts \
  src/components/wysiwyg/SlashCommandMenu.tsx \
  src/components/wysiwyg/SlashCommandMenu.test.tsx \
  src/lib/wysiwygBehavior.integration.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts \
  src/lib/outline.test.ts \
  src/styles.css \
  src/shell/MarkdownPreviewPane.test.tsx \
  src/lib/exportDocument.ts src/lib/exportDocument.test.ts
```

Confirm no secret-like path and no unrelated user change is present.

- [ ] **Step 5: Commit and push the green feature checkpoint**

Stage the exact paths listed in Step 4, then run:

```bash
git add package.json pnpm-lock.yaml src/App.tsx src/editorPlayground.tsx \
  src/components/wysiwyg/headingExtension.ts \
  src/components/wysiwyg/headingExtension.test.ts \
  src/components/wysiwyg/SlashCommandMenu.tsx \
  src/components/wysiwyg/SlashCommandMenu.test.tsx \
  src/lib/wysiwygBehavior.integration.test.ts \
  src/lib/wysiwygRoundtrip.integration.test.ts \
  src/lib/outline.test.ts \
  src/styles.css \
  src/shell/MarkdownPreviewPane.test.tsx \
  src/lib/exportDocument.ts src/lib/exportDocument.test.ts
git diff --cached --check
git commit -m "feat(editor): support h1-h4 heading hierarchy"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected: the commit hook passes, push succeeds without force, and parity is `0 0` before release work begins.

### Task 4: Bump, synchronize, tag, verify, and push the release

**Files:**
- Modify: `VERSION`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `Cargo.lock`

**Interfaces:**
- Consumes: clean `main` at feature/upstream parity
- Produces: next Headatever patch version, synchronized application metadata, annotated `v<version>` tag, and live-remote parity

- [ ] **Step 1: Re-establish the release baseline**

Run:

```bash
git fetch --prune
git status --short --branch
git rev-list --left-right --count HEAD...@{u}
```

Expected: clean `main`, attached HEAD, configured `origin/main`, and `0 0`. Stop rather than pulling or rewriting if upstream advanced.

- [ ] **Step 2: Preview and write the Headatever patch version without creating a partial tag**

Run the bundled Headatever script from its skill directory:

```bash
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --dry-run
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --no-git
pnpm sync-version
```

Expected on 2026-08-03 from `0.260803.2`: `0.260803.3`. `VERSION`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the Markdowner entry in `Cargo.lock` all contain the same version before the tag is created.

- [ ] **Step 3: Verify synchronized release metadata and rebuild**

Run:

```bash
pnpm sync-version -- --check
cargo metadata --locked --format-version 1 --no-deps
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm build
git diff --check
```

Expected: every command passes using the synchronized version. The build artifact reports the new version rather than the previous tag's metadata.

- [ ] **Step 4: Commit the aligned release metadata and create the annotated tag**

Resolve the exact version with `cat VERSION`, confirm `refs/tags/v<version>` does not exist locally or remotely, then explicitly stage only the version files:

```bash
git add VERSION package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
git diff --cached --check
git commit -m "chore(release): v0.260803.3"
git tag -a v0.260803.3 -m "v0.260803.3"
```

If Headatever computes a version other than `0.260803.3`, substitute the script's exact validated value in the commit and tag. Do not reuse an existing tag or move it.

- [ ] **Step 5: Push through Headatever and prove branch/tag parity**

Run:

```bash
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh push
git status --short --branch
git rev-list --left-right --count HEAD...@{u}
git ls-remote origin refs/heads/main refs/tags/v0.260803.3 refs/tags/v0.260803.3^{}
```

Expected: ordinary `git push --follow-tags` succeeds, branch parity is `0 0`, the remote branch points at the release commit, and both annotated tag refs resolve on the live remote.

- [ ] **Step 6: Complete the requirement-by-requirement audit**

Verify the final current state proves every requested outcome:

- H1-H4 are authorable in WYSIWYG and visually distinct.
- Heading 5/6 authoring actions are absent while existing H5/H6 round-trip.
- Preview, HTML, and PDF use semantic H1-H4 with aligned styling.
- Focused tests, full tests, TypeScript, production build, HTML artifact, and PDF artifact passed.
- The feature commit and release commit are pushed.
- `VERSION` and all application metadata match.
- `main`, `origin/main`, live remote main, and the annotated release tag agree.

If final verification requires a code correction, create and push a new focused `fix(...)` commit; never amend or force-push a published checkpoint.
