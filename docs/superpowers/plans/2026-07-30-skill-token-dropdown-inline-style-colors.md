# Skill Token Dropdown and Inline Style Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add installed-skill autocomplete to Source and WYSIWYG editing and add independently persisted light/dark text and background colors for skill tokens and inline code across Source, WYSIWYG, and Preview.

**Architecture:** Keep the existing Tauri skill scan as the single source of installed names. Add small editor-specific suggestion adapters around shared token-query parsing, and expose the active inline-style palette through four root CSS variables resolved from eight validated settings fields. Preview wraps known plain-text tokens through a focused rehype transformer; export styling remains independent.

**Tech Stack:** React 19, TypeScript, CodeMirror 6, Tiptap/ProseMirror, React Markdown/rehype AST, Tailwind CSS, Rust/Serde, Vitest, Cargo test.

---

## File Map

- `src/lib/settings.ts`: TypeScript settings fields, defaults, and normalization.
- `crates/markdowner-core/src/settings.rs`: persisted Rust settings fields, defaults, and field-level deserialization fallback.
- `src/lib/inlineStylePalette.ts`: palette types, defaults, tone resolution, resets, and CSS-variable application.
- `src/lib/inlineStylePalette.test.ts`: palette behavior and DOM-variable tests.
- `src/lib/sourceInlineCode.ts`: CodeMirror inline-code decorations that exclude fenced code.
- `src/lib/sourceInlineCode.test.ts`: real CodeMirror decoration tests.
- `src/lib/previewSkillTokens.ts`: rehype transformer for known skill tokens outside code.
- `src/lib/previewSkillTokens.test.ts`: AST transformation tests.
- `src/lib/skillSuggestions.ts`: shared `/` and `$` query parsing and ordered completion data.
- `src/lib/skillSuggestions.test.ts`: boundary, prefix, filtering, and code-context-independent tests.
- `src/lib/sourceSkillCompletion.ts`: CodeMirror autocomplete adapter and Tab acceptance.
- `src/lib/sourceSkillCompletion.test.ts`: real completion-source tests.
- `src/components/wysiwyg/SkillTokenMenu.tsx`: inline WYSIWYG skill-only popup.
- `src/components/wysiwyg/SkillTokenMenu.test.tsx`: popup trigger, navigation, insertion, and exclusion tests.
- `src/components/wysiwyg/SlashCommandMenu.tsx`: block-start Skills section.
- `src/components/wysiwyg/SlashCommandMenu.test.tsx`: unified Blocks/Skills tests.
- `src/shell/InlineStyleColorSettings.tsx`: theme-first settings cards and color controls.
- `src/shell/InlineStyleColorSettings.test.tsx`: palette editing, preview, and reset tests.
- `src/shell/SettingsPanel.tsx`: embeds the new settings group.
- `src/shell/SettingsPanel.test.tsx`: Settings integration tests.
- `src/shell/WysiwygEditorChrome.tsx`: supplies skill names to both WYSIWYG menus.
- `src/shell/WysiwygEditorChrome.test.tsx`: wiring tests.
- `src/shell/MarkdownPreviewPane.tsx`: supplies skill names to the rehype plugin.
- `src/shell/MarkdownPreviewPane.test.tsx`: Preview DOM and code-exclusion tests.
- `src/App.tsx`: passes installed names, builds Source extensions, applies palette variables.
- `src/App.test.tsx`: end-to-end settings, theme switching, and consumer wiring tests.
- `src/styles.css`: shared variables, inline styles, completion/menu section styles.
- `src/styles.test.ts`: CSS contract tests.
- `package.json`, `pnpm-lock.yaml`: direct CodeMirror autocomplete dependency.

### Task 1: Persist and Resolve Theme-aware Inline Style Colors

**Files:**
- Create: `src/lib/inlineStylePalette.test.ts`
- Create: `src/lib/inlineStylePalette.ts`
- Modify: `src/lib/settings.test.ts`
- Modify: `src/lib/settings.ts`
- Modify: `crates/markdowner-core/src/settings.rs`

- [ ] **Step 1: Write failing TypeScript settings and palette tests**

Add assertions that all eight values exist, malformed values fall back
independently, light/dark palettes resolve correctly, resets affect one tone,
and CSS variables are written:

```ts
expect(DEFAULT_SETTINGS.skillTokenLightTextColor).toBe('#18181B');
expect(DEFAULT_SETTINGS.skillTokenDarkBackgroundColor).toBe('#27272A');
expect(normalizeInlineStyleColor('orange', '#18181B')).toBe('#18181B');
expect(resolveInlineStylePalette(settings, 'dark')).toEqual({
  skillTokenTextColor: settings.skillTokenDarkTextColor,
  skillTokenBackgroundColor: settings.skillTokenDarkBackgroundColor,
  inlineCodeTextColor: settings.inlineCodeDarkTextColor,
  inlineCodeBackgroundColor: settings.inlineCodeDarkBackgroundColor,
});
applyInlineStylePalette(document.documentElement, palette);
expect(document.documentElement.style.getPropertyValue('--skill-token-text-color'))
  .toBe(palette.skillTokenTextColor);
```

- [ ] **Step 2: Run TypeScript tests and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/settings.test.ts src/lib/inlineStylePalette.test.ts \
  --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the new settings fields and palette module do not exist.

- [ ] **Step 3: Write failing Rust settings tests**

Extend `crates/markdowner-core/src/settings.rs` tests:

```rust
#[test]
fn inline_style_colors_default_validate_and_round_trip() {
    let parsed: Settings = serde_json::from_str("{}").expect("settings");
    assert_eq!(parsed.skill_token_light_text_color, "#18181B");
    assert_eq!(parsed.inline_code_dark_background_color, "#27272A");

    let malformed = r#"{
      "skillTokenLightTextColor":"orange",
      "inlineCodeDarkTextColor":"#AABBCC"
    }"#;
    let parsed: Settings = serde_json::from_str(malformed).expect("settings");
    assert_eq!(parsed.skill_token_light_text_color, "#18181B");
    assert_eq!(parsed.inline_code_dark_text_color, "#AABBCC");
}
```

- [ ] **Step 4: Run Rust test and verify RED**

Run:

```bash
cargo test -p markdowner-core settings::tests::inline_style_colors_default_validate_and_round_trip
```

Expected: FAIL because the Rust fields do not exist.

- [ ] **Step 5: Implement the TypeScript settings and palette contract**

Add these `Settings` keys and matching `DEFAULT_SETTINGS` values:

```ts
skillTokenLightTextColor: '#18181B',
skillTokenLightBackgroundColor: '#F4F4F5',
skillTokenDarkTextColor: '#FAFAFA',
skillTokenDarkBackgroundColor: '#27272A',
inlineCodeLightTextColor: '#18181B',
inlineCodeLightBackgroundColor: '#F4F4F5',
inlineCodeDarkTextColor: '#FAFAFA',
inlineCodeDarkBackgroundColor: '#27272A',
```

Create `inlineStylePalette.ts` with:

```ts
export type InlineStyleTone = 'light' | 'dark';
export type InlineStylePalette = {
  skillTokenTextColor: string;
  skillTokenBackgroundColor: string;
  inlineCodeTextColor: string;
  inlineCodeBackgroundColor: string;
};

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

export function normalizeInlineStyleColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value)
    ? value.toUpperCase()
    : fallback;
}

export function applyInlineStylePalette(
  root: HTMLElement,
  palette: InlineStylePalette,
): void {
  root.style.setProperty('--skill-token-text-color', palette.skillTokenTextColor);
  root.style.setProperty('--skill-token-background-color', palette.skillTokenBackgroundColor);
  root.style.setProperty('--inline-code-text-color', palette.inlineCodeTextColor);
  root.style.setProperty('--inline-code-background-color', palette.inlineCodeBackgroundColor);
}
```

Normalize every new setting independently in `normalizeSettings`.

- [ ] **Step 6: Implement the Rust persisted contract**

Add eight `String` fields with `#[serde(default = "...", deserialize_with =
"deserialize_hex_color_or_default")]`, matching default functions, and a
deserializer that accepts only `#RRGGBB` case-insensitively and returns uppercase
defaults field-by-field. Add all values to `Default for Settings`.

- [ ] **Step 7: Verify Task 1 GREEN**

Run:

```bash
pnpm exec vitest run src/lib/settings.test.ts src/lib/inlineStylePalette.test.ts \
  --no-file-parallelism --maxWorkers=1
cargo test -p markdowner-core settings
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: all selected tests and type checking PASS.

- [ ] **Step 8: Commit and push Task 1**

```bash
git add src/lib/settings.ts src/lib/settings.test.ts \
  src/lib/inlineStylePalette.ts src/lib/inlineStylePalette.test.ts \
  crates/markdowner-core/src/settings.rs
git commit -m "feat(settings): add inline style color palettes"
git push
git rev-list --left-right --count HEAD...@{upstream}
```

Expected parity: `0 0`.

### Task 2: Style Source, WYSIWYG, and Preview from One Palette

**Files:**
- Create: `src/lib/sourceInlineCode.test.ts`
- Create: `src/lib/sourceInlineCode.ts`
- Create: `src/lib/previewSkillTokens.test.ts`
- Create: `src/lib/previewSkillTokens.ts`
- Modify: `src/shell/MarkdownPreviewPane.test.tsx`
- Modify: `src/shell/MarkdownPreviewPane.tsx`
- Modify: `src/styles.test.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing Source inline-code decoration tests**

Use a real CodeMirror Markdown state:

```ts
const field = createSourceInlineCodeExtension();
const state = EditorState.create({
  doc: 'use `pnpm test`\n```sh\npnpm test\n```',
  extensions: [markdown(), field],
});
expect(decorationRanges(state, field)).toEqual([
  { from: 4, to: 16, cls: 'cm-inline-code' },
]);
```

- [ ] **Step 2: Write failing Preview token tests**

Render:

```tsx
<MarkdownPreviewPane
  source={'Run /goal and `$git-commit`.\\n\\n```sh\\n/goal\\n```'}
  skillNames={new Set(['goal', 'git-commit'])}
  highlightSkillTokens
/>
```

Assert one `.preview-skill-token` with `/goal`, no wrapper within `code`, and
ordinary inline/fenced code elements remain present.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/sourceInlineCode.test.ts \
  src/lib/previewSkillTokens.test.ts src/shell/MarkdownPreviewPane.test.tsx \
  src/styles.test.ts --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the extensions, Preview props, and CSS variables are absent.

- [ ] **Step 4: Implement Source inline-code decorations**

Create a `StateField<DecorationSet>` that reads `syntaxTree(state)`, marks only
Markdown `InlineCode` nodes with `cm-inline-code`, rescans after document
changes, and provides the field through `EditorView.decorations`.

- [ ] **Step 5: Implement Preview wrapping**

Create a rehype plugin factory:

```ts
export function createPreviewSkillTokenPlugin(
  skillNames: ReadonlySet<string>,
  enabled: boolean,
) {
  return () => (tree: HastRoot) => {
    transformChildren(tree, skillNames, enabled, false);
  };
}
```

Recursively split plain text nodes with `findSkillTokenRanges`, emit `span`
elements with `className: ['preview-skill-token']`, and propagate an `inCode`
flag through `code` and `pre` ancestors.

Pass the plugin through `ReactMarkdown`'s `rehypePlugins` only when enabled and
the name set is non-empty.

- [ ] **Step 6: Implement the shared CSS-variable contract**

Define neutral fallbacks on `:root` and update selectors:

```css
:root {
  --skill-token-text-color: #18181b;
  --skill-token-background-color: #f4f4f5;
  --inline-code-text-color: #18181b;
  --inline-code-background-color: #f4f4f5;
}

.cm-skill-token,
.wysiwyg-skill-token,
.preview-skill-token {
  color: var(--skill-token-text-color);
  background-color: var(--skill-token-background-color);
}

.cm-inline-code,
.markdown-surface :not(pre) > code {
  color: var(--inline-code-text-color);
  background-color: var(--inline-code-background-color);
}
```

Keep `pre code` transparent and exclude `.code-block-view` descendants.

- [ ] **Step 7: Verify Task 2 GREEN**

Run the focused Vitest command from Step 3 and:

```bash
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit and push Task 2**

```bash
git add src/lib/sourceInlineCode.ts src/lib/sourceInlineCode.test.ts \
  src/lib/previewSkillTokens.ts src/lib/previewSkillTokens.test.ts \
  src/shell/MarkdownPreviewPane.tsx src/shell/MarkdownPreviewPane.test.tsx \
  src/styles.css src/styles.test.ts
git commit -m "feat(editor): apply theme-aware inline styles"
git push
git rev-list --left-right --count HEAD...@{upstream}
```

Expected parity: `0 0`.

### Task 3: Add Shared Skill Queries and Source Completion

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/lib/skillSuggestions.test.ts`
- Create: `src/lib/skillSuggestions.ts`
- Create: `src/lib/sourceSkillCompletion.test.ts`
- Create: `src/lib/sourceSkillCompletion.ts`
- Modify: `src/lib/sourceEditorExtensions.test.ts`
- Modify: `src/lib/sourceEditorExtensions.ts`

- [ ] **Step 1: Write failing shared query tests**

Define the wished-for API:

```ts
expect(findSkillSuggestionQuery('Run /gi')).toEqual({
  prefix: '/',
  query: 'gi',
  from: 4,
  to: 7,
});
expect(findSkillSuggestionQuery('price$go')).toBeNull();
expect(findSkillSuggestionQuery('DELETE /api/users')).toBeNull();
expect(buildSkillSuggestions('/', 'git', new Set(['goal', 'git-commit'])))
  .toEqual([{ name: 'git-commit', token: '/git-commit' }]);
```

- [ ] **Step 2: Write failing CodeMirror completion tests**

Call the completion source with real `CompletionContext` instances and assert:

```ts
expect(result?.from).toBe(4);
expect(result?.options.map((option) => option.label)).toEqual([
  '/git-commit',
  '/git-commit-push',
]);
expect(result?.options[0].apply).toBe('/git-commit');
```

Add inline-code and fenced-code cases that return `null`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/skillSuggestions.test.ts \
  src/lib/sourceSkillCompletion.test.ts src/lib/sourceEditorExtensions.test.ts \
  --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 4: Add the direct autocomplete dependency**

Run:

```bash
pnpm add @codemirror/autocomplete@^6.20.1
```

Expected: package manifest and lockfile include the direct dependency without
changing unrelated package versions.

- [ ] **Step 5: Implement shared query parsing**

`findSkillSuggestionQuery` accepts tokens that begin at index zero or after
whitespace and match `[/$][A-Za-z0-9_-]*(?::[A-Za-z0-9_-]*)?` through the
caret. It returns the absolute replacement range including the prefix.

`buildSkillSuggestions` sorts/deduplicates installed names and fuzzy-filters
them through the existing ranking helper while preserving the supplied prefix.

- [ ] **Step 6: Implement Source autocomplete**

Create `createSourceSkillCompletionExtension(skillNames)` using:

```ts
autocompletion({
  override: [createSkillCompletionSource(skillNames)],
  activateOnTyping: true,
}),
keymap.of([{ key: 'Tab', run: acceptCompletion }]),
```

The source inspects `syntaxTree(context.state).resolveInner(context.pos, -1)`
and returns `null` when an ancestor is inline/fenced/code content. Completion
options replace the full trigger/query range with `suggestion.token`.

Add the extension to `buildSourceEditorExtensions` through a new `skillNames`
option so completion exists even when visual highlighting is disabled.

- [ ] **Step 7: Verify Task 3 GREEN**

Run the focused Vitest command from Step 3 and:

```bash
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit and push Task 3**

```bash
git add package.json pnpm-lock.yaml \
  src/lib/skillSuggestions.ts src/lib/skillSuggestions.test.ts \
  src/lib/sourceSkillCompletion.ts src/lib/sourceSkillCompletion.test.ts \
  src/lib/sourceEditorExtensions.ts src/lib/sourceEditorExtensions.test.ts
git commit -m "feat(source): suggest installed skill tokens"
git push
git rev-list --left-right --count HEAD...@{upstream}
```

Expected parity: `0 0`.

### Task 4: Add Context-aware WYSIWYG Skill Menus

**Files:**
- Create: `src/components/wysiwyg/SkillTokenMenu.test.tsx`
- Create: `src/components/wysiwyg/SkillTokenMenu.tsx`
- Modify: `src/components/wysiwyg/SlashCommandMenu.test.tsx`
- Modify: `src/components/wysiwyg/SlashCommandMenu.tsx`
- Modify: `src/shell/WysiwygEditorChrome.test.tsx`
- Modify: `src/shell/WysiwygEditorChrome.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing unified slash-menu tests**

Render `SlashCommandMenu` with `skillNames={new Set(['goal', 'git-commit'])}`.
After the mocked editor reports `/gi` at block start, assert:

```ts
expect(screen.getByText('Blocks')).toBeInTheDocument();
expect(screen.getByText('Skills')).toBeInTheDocument();
expect(screen.getByRole('menuitem', { name: /\/git-commit/i }))
  .toBeInTheDocument();
```

Click the skill and assert the chain replaces `/gi` with `/git-commit`. Confirm
convert mode has no Skills section.

- [ ] **Step 2: Write failing inline skill-menu tests**

Cover `Run /gi`, `Run $gi`, navigation, Enter/Tab insertion, Escape, pointer
selection, no names, non-empty selection, code mark/block, URL/path contents,
and block-start slash ownership.

- [ ] **Step 3: Run focused WYSIWYG tests and verify RED**

Run:

```bash
pnpm exec vitest run src/components/wysiwyg/SlashCommandMenu.test.tsx \
  src/components/wysiwyg/SkillTokenMenu.test.tsx \
  src/shell/WysiwygEditorChrome.test.tsx \
  --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because skill props/menu behavior are absent.

- [ ] **Step 4: Extend SlashCommandMenu for block-start skills**

Add `skillNames?: ReadonlySet<string>` to props. In typed insert mode, map
shared suggestions to dynamic items:

```ts
{
  id: `skill:${suggestion.name}`,
  title: suggestion.token,
  description: 'Installed skill',
  group: 'skills',
  kind: 'skill-token',
}
```

Retain block items under `Blocks`, render section headers, and make `runItem`
replace the typed range with the exact skill token. Convert mode remains
block-only.

- [ ] **Step 5: Implement SkillTokenMenu**

Watch WYSIWYG selection/update events. Own `$` at any valid boundary and `/`
after non-leading whitespace; leave leading `/` to `SlashCommandMenu`. Skip
code nodes/marks and non-empty selections. Reuse the slash menu's classes,
viewport placement, pointer preservation, list navigation, and outside-click
dismissal.

- [ ] **Step 6: Wire both menus through WysiwygEditorChrome**

Add:

```tsx
<SlashCommandMenu editor={editor} enabled={enabled} skillNames={skillNames} />
<SkillTokenMenu editor={editor} enabled={enabled} skillNames={skillNames} />
```

Ensure the two components never open for the same trigger.

- [ ] **Step 7: Verify Task 4 GREEN**

Run the focused command from Step 3 and:

```bash
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit and push Task 4**

```bash
git add src/components/wysiwyg/SkillTokenMenu.tsx \
  src/components/wysiwyg/SkillTokenMenu.test.tsx \
  src/components/wysiwyg/SlashCommandMenu.tsx \
  src/components/wysiwyg/SlashCommandMenu.test.tsx \
  src/shell/WysiwygEditorChrome.tsx src/shell/WysiwygEditorChrome.test.tsx \
  src/styles.css
git commit -m "feat(wysiwyg): add contextual skill token menu"
git push
git rev-list --left-right --count HEAD...@{upstream}
```

Expected parity: `0 0`.

### Task 5: Add Theme-first Settings UI and App Integration

**Files:**
- Create: `src/shell/InlineStyleColorSettings.test.tsx`
- Create: `src/shell/InlineStyleColorSettings.tsx`
- Modify: `src/shell/SettingsPanel.test.tsx`
- Modify: `src/shell/SettingsPanel.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing color-settings component tests**

Render with `DEFAULT_SETTINGS`; assert Light is initially selected, both
previews show, color fields expose the Light values, Dark selection changes the
values without calling `onChange`, edits return a full `Settings` object, and
`Reset Dark colors` changes only the four dark fields.

- [ ] **Step 2: Write failing App integration tests**

Mock settings and installed names, then assert:

```ts
expect(document.documentElement.style.getPropertyValue('--skill-token-text-color'))
  .toBe('#112233');
expect(sourceSkillCompletionMock.create).toHaveBeenCalledWith(
  new Set(['goal', 'git-commit']),
);
expect(screen.getByTestId('markdown-preview-pane'))
  .toHaveAttribute('data-skill-highlight', 'true');
```

Switch BuiltInLight/BuiltInDark and verify the variables change to the
corresponding saved fields. Change a color through Settings, assert
`save_settings` receives it, and verify immediate active-palette application.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run src/shell/InlineStyleColorSettings.test.tsx \
  src/shell/SettingsPanel.test.tsx src/App.test.tsx \
  --no-file-parallelism --maxWorkers=1 \
  -t 'Inline styles|skill token|inline code|installed skill names'
```

Expected: FAIL because the UI and App wiring do not exist.

- [ ] **Step 4: Implement InlineStyleColorSettings**

Use local state only for the selected edit tone. Render a `ToggleGroup` for
Light/Dark, two cards with inline previews, and four color controls. Normalize
text input on commit and use the native color input for immediate changes.
Per-tone reset merges `inlineStyleDefaultsForTone(tone)` into the current
settings without touching the other tone.

- [ ] **Step 5: Embed the settings group**

Render `InlineStyleColorSettings` directly below the existing Skill Token
Highlighting switch and forward every change through `onSettingsChange`.

- [ ] **Step 6: Wire App consumers and active CSS variables**

Resolve tone from `snapshot.theme.kind`; for `CustomCss`, use the existing OS
color-scheme state. In an effect:

```ts
const palette = resolveInlineStylePalette(settings, inlineStyleTone);
applyInlineStylePalette(document.documentElement, palette);
```

Pass `skillTokenNames` to `WysiwygEditorChrome` and `MarkdownPreviewPane`.
Always include Source skill completion and inline-code decoration; include
Source skill highlighting only when `highlightSkillTokens` is true.

- [ ] **Step 7: Verify Task 5 GREEN**

Run focused tests without the name filter if App filtering misses unrelated
setup:

```bash
pnpm exec vitest run src/shell/InlineStyleColorSettings.test.tsx \
  src/shell/SettingsPanel.test.tsx src/App.test.tsx \
  --no-file-parallelism --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit and push Task 5**

```bash
git add src/shell/InlineStyleColorSettings.tsx \
  src/shell/InlineStyleColorSettings.test.tsx \
  src/shell/SettingsPanel.tsx src/shell/SettingsPanel.test.tsx \
  src/App.tsx src/App.test.tsx
git commit -m "feat(settings): customize inline style colors"
git push
git rev-list --left-right --count HEAD...@{upstream}
```

Expected parity: `0 0`.

### Task 6: Full Verification and Installed-app QA

**Files:**
- Modify only files required by failures attributable to this feature.

- [ ] **Step 1: Run the complete frontend suite**

```bash
pnpm exec vitest run --no-file-parallelism --maxWorkers=1
```

Expected: all tests PASS. If the known `App.test.tsx` order/timing flake appears,
record the failing names, rerun those exact names in isolation, and do not
misrepresent the full-run result.

- [ ] **Step 2: Run Rust, type, lint, and audit gates**

```bash
cargo test --workspace
pnpm exec tsc --noEmit --pretty false
cargo clippy --workspace --all-targets -- -D warnings
pnpm audit
cargo audit
pnpm sync-version -- --check
bash scripts/build-and-install.test.sh
bash src-tauri/scripts/self-update.test.sh
```

Expected: commands exit zero; `cargo audit` may report repository-allowed
warnings but no unallowed vulnerability failure.

- [ ] **Step 3: Build and install**

```bash
pnpm build:install
defaults read /Applications/Markdowner.app/Contents/Info CFBundleShortVersionString
codesign --verify --deep --strict --verbose=2 /Applications/Markdowner.app
```

Expected: build/install succeeds, installed version matches `VERSION`, and
codesign verification succeeds.

- [ ] **Step 4: Verify runtime behavior**

Open a temporary Markdown file containing:

```md
# Skill menu QA

Run /goal and $git-commit.
Use `inline code` and:

```sh
/goal
```
```

In the installed app verify:

- WYSIWYG leading `/` shows Blocks and Skills.
- WYSIWYG inline `/` and `$` show Skills only.
- Source `/` and `$` show installed skill completions.
- keyboard and pointer selection preserve the prefix.
- code contexts show no skill menu/highlight.
- Source, WYSIWYG, and Preview share custom Light colors.
- switching to Dark applies the saved Dark colors.
- relaunch preserves all eight values.
- Reset affects only the selected tone.
- Export Preview retains its separate inline-code palette.

- [ ] **Step 5: Commit and push any corrective feature diff**

If verification requires source changes:

```bash
git add package.json pnpm-lock.yaml \
  crates/markdowner-core/src/settings.rs \
  src/App.tsx src/App.test.tsx src/styles.css src/styles.test.ts \
  src/components/wysiwyg/SlashCommandMenu.tsx \
  src/components/wysiwyg/SlashCommandMenu.test.tsx \
  src/components/wysiwyg/SkillTokenMenu.tsx \
  src/components/wysiwyg/SkillTokenMenu.test.tsx \
  src/lib/inlineStylePalette.ts src/lib/inlineStylePalette.test.ts \
  src/lib/previewSkillTokens.ts src/lib/previewSkillTokens.test.ts \
  src/lib/settings.ts src/lib/settings.test.ts \
  src/lib/skillSuggestions.ts src/lib/skillSuggestions.test.ts \
  src/lib/sourceEditorExtensions.ts src/lib/sourceEditorExtensions.test.ts \
  src/lib/sourceInlineCode.ts src/lib/sourceInlineCode.test.ts \
  src/lib/sourceSkillCompletion.ts src/lib/sourceSkillCompletion.test.ts \
  src/shell/InlineStyleColorSettings.tsx \
  src/shell/InlineStyleColorSettings.test.tsx \
  src/shell/MarkdownPreviewPane.tsx src/shell/MarkdownPreviewPane.test.tsx \
  src/shell/SettingsPanel.tsx src/shell/SettingsPanel.test.tsx \
  src/shell/WysiwygEditorChrome.tsx src/shell/WysiwygEditorChrome.test.tsx
git commit -m "fix(editor): correct inline style customization"
git push
```

Do not create an empty or verification-only commit.

- [ ] **Step 6: Prove final repository state**

```bash
git diff --check
git status --short --branch
git log --oneline 0983f237f7c11933405f685eee9b38f0b240d4be..HEAD
git rev-list --left-right --count HEAD...@{upstream}
```

Expected: clean tree, all feature checkpoints listed, parity `0 0`.
