# Solar Pro 4 Default and Selection AI Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repository's AGENTS.md requires inline execution; do not dispatch subagents.

**Goal:** Make drag-selection AI actions reliably open a keyboard-ready prompt and make `upstage/solar-pro4` the first, version-migrated default for every AI task.

**Architecture:** Preserve the latest valid non-empty ProseMirror range inside `SelectionToolbar`, then pass it through the existing exact Markdown/UTF-8 snapshot and Review-safe application pipeline. Keep the existing OpenRouter prompt surface, adding autofocus and IME-safe Enter submission. Add a versioned settings migration in the frontend while keeping TypeScript and Rust defaults synchronized with the shared Solar-first model policy.

**Tech Stack:** React 19, TypeScript 5.8, Tiptap/ProseMirror 3, Vitest 4 and Testing Library, Tauri 2, Rust/Serde, pnpm, Headatever, Git.

## Global Constraints

- Preserve Improve, Rewrite, Shorten, Expand, Make table, Custom instruction, and the existing model selector.
- Apply a successful WYSIWYG replacement as one undoable Tiptap transaction.
- Send stale, invalid, or uninsertable output to Review; never redirect it to another range.
- Enter submits a typed custom instruction; Shift+Enter inserts a newline.
- Do not submit while `nativeEvent.isComposing` is true, `keyCode` is `229`, or the key is `Process`.
- Use `upstage/solar-pro4` as the frontend registry, frontend settings, and Rust settings default.
- Put Solar Pro 4 first and GLM 5.2 second in every shared model selector.
- Migrate each exact persisted `z-ai/glm-5.2` task field independently only while `aiModelDefaultsVersion < 1`.
- Preserve valid non-GLM values during migration and preserve intentional GLM selections after version `1`.
- Do not make a paid OpenRouter request during automated or installed-app verification.
- Stage only explicit files, use Conventional Commit subjects, push every green checkpoint immediately, and verify upstream parity `0 0`.

---

## File Map

- `src/components/wysiwyg/SelectionToolbar.tsx`: retain and activate the latest valid WYSIWYG text range.
- `src/components/wysiwyg/SelectionToolbar.test.tsx`: reproduce selection collapse between toolbar mouse down and click with a real Tiptap editor.
- `src/App.tsx`: announce failures to capture the retained range and open the existing prompt only for valid snapshots.
- `src/App.test.tsx`: cover visible capture failure and keep the exact-range/OpenRouter integration green.
- `src/features/ai/AiSelectionPopover.tsx`: autofocus the prompt and implement IME-safe Enter submission.
- `src/features/ai/AiSelectionPopover.test.tsx`: cover focus, Enter, Shift+Enter, and composition behavior.
- `src/features/ai/model.ts`: define Solar as the canonical default and first pinned choice.
- `src/features/ai/model.test.ts`: lock the Solar-first canonical policy.
- `src/features/ai/OpenRouterSettings.test.tsx`: lock Solar-first ordering across all four Settings selectors.
- `src/lib/settings.ts`: add `aiModelDefaultsVersion`, migrate legacy GLM fields, and best-effort persist migration results.
- `src/lib/settings.test.ts`: cover defaults, independent migration, idempotence, malformed values, and save failure.
- `crates/markdowner-core/src/settings.rs`: align the serialized settings contract and distinguish legacy missing version `0` from new default version `1`.
- `VERSION`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock`: Headatever patch version and synchronized release metadata.

### Task 1: Preserve the WYSIWYG Selection Through Toolbar Activation

**Files:**
- Modify: `src/components/wysiwyg/SelectionToolbar.tsx:44-265`
- Test: `src/components/wysiwyg/SelectionToolbar.test.tsx:1-155`
- Modify: `src/App.tsx:4025-4060`
- Test: `src/App.test.tsx:1599-1745`

**Interfaces:**
- Consumes: Tiptap `Editor.state.selection` with `{ from: number; to: number; empty: boolean }`.
- Produces: unchanged `onAiSelection(selection: { from: number; to: number }): void` callback using the retained range.
- Produces: `announceShell('The selected text could not be captured. Select it again and retry.')` when exact snapshot capture fails.

- [ ] **Step 1: Write the failing retained-range regression test**

Create a real Tiptap editor with StarterKit, stub only geometry/focus unavailable in JSDOM, set a text selection, render the toolbar, then collapse the editor selection between mouse down and click:

```tsx
const editor = new Editor({
  element: document.createElement('div'),
  extensions: [StarterKit],
  content: '<p>alpha beta</p>',
});
vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
  top: 80, bottom: 100, left: 40, right: 60,
});
vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
const onAiSelection = vi.fn();
render(<SelectionToolbar editor={editor} onAiSelection={onAiSelection} />);
act(() => editor.commands.setTextSelection({ from: 2, to: 6 }));
const button = await screen.findByRole('button', { name: 'AI actions' });
fireEvent.mouseDown(button);
act(() => editor.commands.setTextSelection(6));
fireEvent.click(button);
expect(onAiSelection).toHaveBeenCalledWith({ from: 2, to: 6 });
editor.destroy();
```

- [ ] **Step 2: Run the toolbar test and verify the new test fails**

Run: `pnpm exec vitest run --maxWorkers=1 src/components/wysiwyg/SelectionToolbar.test.tsx`

Expected: FAIL because the click handler re-reads collapsed range `{ from: 6, to: 6 }` and never calls `onAiSelection`.

- [ ] **Step 3: Retain the latest valid range in `SelectionToolbar`**

Add a ref and update it only after `computePosition` validates a non-empty, non-cell, non-code-block selection:

```tsx
const aiSelectionRef = useRef<{ from: number; to: number } | null>(null);

// Inside computePosition, after all selection eligibility checks:
aiSelectionRef.current = { from, to };

// Reset only when the editor changes or the feature is disabled.
useEffect(() => {
  if (!editor || !enabled) aiSelectionRef.current = null;
}, [editor, enabled]);

// AI button activation:
onClick={() => {
  const selection = aiSelectionRef.current;
  if (selection) onAiSelection(selection);
}}
```

Do not make pointer down the action trigger; keep the semantic button click path for mouse and keyboard activation.

- [ ] **Step 4: Add an application-level capture-failure assertion**

In `src/App.test.tsx`, configure the WYSIWYG mock with an out-of-document range that maps both Markdown offsets to `0`, click AI actions, and assert:

```tsx
expect(await screen.findByTestId('shell-live-region')).toHaveTextContent(
  'The selected text could not be captured. Select it again and retry.',
);
expect(screen.queryByTestId('ai-selection-popover')).toBeNull();
```

- [ ] **Step 5: Announce invalid WYSIWYG capture instead of returning silently**

Change the handler to announce both an unavailable input and a null snapshot:

```tsx
if (!editor || !activeDocumentTab || selection.from === selection.to) {
  announceShell('The selected text could not be captured. Select it again and retry.');
  return;
}
// ...capture...
if (!captured) {
  announceShell('The selected text could not be captured. Select it again and retry.');
  return;
}
```

- [ ] **Step 6: Run selection entry tests**

Run: `pnpm exec vitest run --maxWorkers=1 src/components/wysiwyg/SelectionToolbar.test.tsx src/App.test.tsx -t "retains|could not be captured|keeps AI actions on OpenRouter"`

Expected: PASS; the retained range opens the prompt, invalid capture is announced, and the existing OpenRouter/local-agent handoff still passes.

### Task 2: Make the Existing Prompt Keyboard-Ready and IME-Safe

**Files:**
- Modify: `src/features/ai/AiSelectionPopover.tsx:59-175,210-245`
- Test: `src/features/ai/AiSelectionPopover.test.tsx:1-180`

**Interfaces:**
- Consumes: existing `handleRun(): Promise<void>` and computed `canRun`.
- Produces: textarea focus on mount and `onKeyDown` behavior with Enter, Shift+Enter, `nativeEvent.isComposing`, `keyCode === 229`, and `key === 'Process'`.

- [ ] **Step 1: Add failing focus and keyboard tests**

Use configured services and cloud consent, type a custom instruction, wait for `Run on selection` to enable, and assert:

```tsx
const prompt = screen.getByLabelText('Prompt for selected text');
expect(prompt).toHaveFocus();
fireEvent.change(prompt, { target: { value: 'Make this uppercase' } });
await waitFor(() => expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled());
fireEvent.keyDown(prompt, { key: 'Enter' });
await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
```

Add separate assertions that Shift+Enter is not prevented and does not run, and that composing Enter plus key code `229` do not run.

- [ ] **Step 2: Run the prompt test and verify failures**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/AiSelectionPopover.test.tsx`

Expected: FAIL because the textarea is not focused on open and has no Enter handler.

- [ ] **Step 3: Add autofocus and guarded Enter submission**

Focus once when the popover mounts and add the textarea handler:

```tsx
useEffect(() => {
  promptRef.current?.focus();
}, []);

onKeyDown={(event) => {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.keyCode === 229 ||
    event.key === 'Process'
  ) return;
  event.preventDefault();
  void handleRun();
}}
```

Keep `onChange` selecting `actionId = 'custom'`; do not alter quick-action or model-selector state.

- [ ] **Step 4: Run focused prompt and selection safety tests**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/AiSelectionPopover.test.tsx src/features/ai/selection.test.ts src/App.test.tsx -t "custom prompt|focus|Enter|Shift|compos|selection|Review"`

Expected: PASS, including exact range, one transaction, stale snapshot, and Review fallback cases.

- [ ] **Step 5: Review, stage, commit, and push the complete selection repair**

Run:

```bash
git diff --check
git add src/components/wysiwyg/SelectionToolbar.tsx src/components/wysiwyg/SelectionToolbar.test.tsx src/features/ai/AiSelectionPopover.tsx src/features/ai/AiSelectionPopover.test.tsx src/App.tsx src/App.test.tsx
git diff --cached --check
git commit -m "fix(ai): make selection prompt entry reliable"
git push origin main
git fetch origin
git rev-list --left-right --count HEAD...origin/main
```

Expected: commit succeeds and parity is `0 0`.

### Task 3: Make Solar Pro 4 the Canonical First Model

**Files:**
- Modify: `src/features/ai/model.ts:12-38`
- Test: `src/features/ai/model.test.ts:33-70`
- Test: `src/features/ai/OpenRouterSettings.test.tsx:7-100`
- Modify: `src/lib/settings.ts:127-137,181-183,240-280,429-572,662-677`
- Test: `src/lib/settings.test.ts:475-560`
- Modify: `crates/markdowner-core/src/settings.rs:7,140-229,231-291,670-720`

**Interfaces:**
- Produces: `DEFAULT_AI_MODEL = 'upstage/solar-pro4'` in TypeScript and `DEFAULT_AI_MODEL: &str = "upstage/solar-pro4"` in Rust.
- Produces: `AI_MODEL_DEFAULTS_VERSION = 1` and `Settings.aiModelDefaultsVersion: number`.
- Consumes: exact legacy ID `z-ai/glm-5.2`; no fuzzy or label-based migration.

- [ ] **Step 1: Write failing model-order and default tests**

Update expectations so `PINNED_AI_MODELS` begins:

```ts
expect(DEFAULT_AI_MODEL).toBe('upstage/solar-pro4');
expect(PINNED_AI_MODELS.slice(0, 2)).toEqual([
  'upstage/solar-pro4',
  'z-ai/glm-5.2',
]);
```

Update all four Settings selector expectations to the same Solar-first order.

- [ ] **Step 2: Write failing frontend migration tests**

Add tests for these exact inputs and outputs:

```ts
// Missing version: migrate each old default independently.
invokeMock.mockResolvedValue({
  aiPrdModel: 'z-ai/glm-5.2',
  aiSummaryModel: 'moonshotai/kimi-k3',
  aiTranslationModel: 'z-ai/glm-5.2',
  aiCustomPromptModel: 'vendor/custom',
});
// Expect Solar, Kimi, Solar, vendor/custom, version 1 and one save_settings call.

// Current version: preserve an intentional GLM selection and make no migration save.
invokeMock.mockResolvedValue({
  ...DEFAULT_SETTINGS,
  aiModelDefaultsVersion: 1,
  aiPrdModel: 'z-ai/glm-5.2',
});

// Save failure: load_settings resolves legacy data, save_settings rejects,
// loadSettings still resolves migrated in-memory values and logs once.
```

- [ ] **Step 3: Write failing Rust default/version tests**

Assert new defaults serialize Solar and version `1`, while legacy JSON without the field deserializes version `0`:

```rust
let defaults = Settings::default();
assert_eq!(defaults.ai_model_defaults_version, 1);
assert_eq!(defaults.ai_prd_model, "upstage/solar-pro4");

let legacy: Settings = serde_json::from_str(r#"{"aiPrdModel":"z-ai/glm-5.2"}"#)
    .expect("legacy settings parse");
assert_eq!(legacy.ai_model_defaults_version, 0);
```

- [ ] **Step 4: Run model and settings tests and verify failures**

Run:

```bash
pnpm exec vitest run --maxWorkers=1 src/features/ai/model.test.ts src/features/ai/OpenRouterSettings.test.tsx src/lib/settings.test.ts
cargo test -p markdowner-core settings --all-features
```

Expected: FAIL on the old GLM default/order and the missing migration version contract.

- [ ] **Step 5: Implement Solar-first model policy**

Set the canonical default and reorder pinned choices without removing GLM:

```ts
export const DEFAULT_AI_MODEL = 'upstage/solar-pro4';
export const PINNED_AI_MODEL_CHOICES = [
  { id: DEFAULT_AI_MODEL, label: 'Solar Pro 4', contextLength: 524_288 },
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2', contextLength: 1_048_576 },
  // unchanged remaining entries
] as const;
```

- [ ] **Step 6: Implement versioned frontend normalization and persistence**

Add `aiModelDefaultsVersion` to `Settings` and `DEFAULT_SETTINGS`, and normalize the raw version before spreading defaults:

```ts
export const AI_MODEL_DEFAULTS_VERSION = 1;
const LEGACY_DEFAULT_AI_MODEL = 'z-ai/glm-5.2';
const AI_MODEL_SETTING_KEYS = [
  'aiPrdModel',
  'aiSummaryModel',
  'aiTranslationModel',
  'aiCustomPromptModel',
] as const;

function normalizeSettings(value: Partial<Settings> | null | undefined): {
  settings: Settings;
  migratedAiModelDefaults: boolean;
} {
  const rawVersion = value?.aiModelDefaultsVersion;
  const storedVersion = typeof rawVersion === 'number' && Number.isInteger(rawVersion)
    ? rawVersion
    : 0;
  const migratedAiModelDefaults = storedVersion < AI_MODEL_DEFAULTS_VERSION;
  const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  merged.aiModelDefaultsVersion = storedVersion;
  // existing field validation first
  if (migratedAiModelDefaults) {
    for (const key of AI_MODEL_SETTING_KEYS) {
      if (merged[key] === LEGACY_DEFAULT_AI_MODEL) merged[key] = DEFAULT_AI_MODEL;
    }
    merged.aiModelDefaultsVersion = AI_MODEL_DEFAULTS_VERSION;
  }
  return { settings: merged, migratedAiModelDefaults };
}
```

Update `loadSettings` to call `save_settings` in a nested best-effort `try/catch` only when migration occurred. Update `saveSettings` to pass `normalizeSettings(settings).settings`.

- [ ] **Step 7: Implement the Rust version/default contract**

Use a field-specific legacy default so container-level `#[serde(default)]` does not substitute the new-construction version:

```rust
pub const DEFAULT_AI_MODEL: &str = "upstage/solar-pro4";
pub const AI_MODEL_DEFAULTS_VERSION: u32 = 1;

fn legacy_ai_model_defaults_version() -> u32 { 0 }

#[serde(default = "legacy_ai_model_defaults_version")]
pub ai_model_defaults_version: u32,

// Settings::default()
ai_model_defaults_version: AI_MODEL_DEFAULTS_VERSION,
```

- [ ] **Step 8: Run focused frontend and Rust tests**

Run:

```bash
pnpm exec vitest run --maxWorkers=1 src/features/ai/model.test.ts src/features/ai/OpenRouterSettings.test.tsx src/lib/settings.test.ts
cargo test -p markdowner-core settings --all-features
```

Expected: PASS with Solar first, independent legacy migration, single persistence, current-version GLM preservation, and Rust legacy version `0`.

- [ ] **Step 9: Review, stage, commit, and push the Solar checkpoint**

Run:

```bash
git diff --check
git add src/features/ai/model.ts src/features/ai/model.test.ts src/features/ai/OpenRouterSettings.test.tsx src/lib/settings.ts src/lib/settings.test.ts crates/markdowner-core/src/settings.rs
git diff --cached --check
git commit -m "feat(ai): default tasks to Solar Pro 4"
git push origin main
git fetch origin
git rev-list --left-right --count HEAD...origin/main
```

Expected: commit succeeds and parity is `0 0`.

### Task 4: Run the Full Verification Matrix and Install the App

**Files:**
- Verify only: all source and test files from Tasks 1-3.
- Build artifact: `src-tauri/target/universal-apple-darwin/release/bundle/macos/Markdowner.app`
- Installed artifact: `/Applications/Markdowner.app`

**Interfaces:**
- Consumes: both green implementation checkpoints.
- Produces: test/build evidence and a synchronized local installed binary without any paid AI request.

- [ ] **Step 1: Run frontend and static verification**

Run:

```bash
pnpm exec vitest run --maxWorkers=1
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: all Vitest files pass, TypeScript emits no diagnostics, production build succeeds, and the worktree has no whitespace errors.

- [ ] **Step 2: Run Rust verification**

Run:

```bash
cargo fmt --all -- --check
cargo test --workspace --all-targets --all-features
```

Expected: formatting and every Rust target/feature test pass.

- [ ] **Step 3: Build and install the final app without opening it**

Run: `pnpm build:install`

Expected: the synchronized app is copied to `/Applications/Markdowner.app`.

- [ ] **Step 4: Verify the installed artifact**

Compare source/built/installed versions, run `codesign --verify --deep --strict`, inspect executable architectures with `lipo -archs`, and compare SHA-256 hashes of the built and installed executables. Confirm a non-billable local interaction opens the prompt after drag selection; do not press Enter or Run.

### Task 5: Publish a Headatever Patch Release and Finalize Remote Parity

**Files:**
- Modify through Headatever: `VERSION`
- Modify through version sync: `package.json`
- Modify through version sync: `src-tauri/tauri.conf.json`
- Modify through version sync: `src-tauri/Cargo.toml`
- Modify through version sync: `Cargo.lock`

**Interfaces:**
- Consumes: clean, fully verified implementation at upstream parity `0 0`.
- Produces: Headatever release commit and annotated tag, followed by synchronized metadata commit and final installed build.

- [ ] **Step 1: Verify clean release baseline and dry-run the bump**

Run:

```bash
git fetch origin
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --dry-run
```

Expected: clean tree, parity `0 0`, and one valid next patch version.

- [ ] **Step 2: Create the Headatever release commit and tag**

Run: `/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch`

Expected: a `VERSION` commit named for the exact dry-run version and an annotated tag with the same `v`-prefixed version.

- [ ] **Step 3: Synchronize every version surface and retest version checks**

Run:

```bash
pnpm sync-version
pnpm exec tsc --noEmit
cargo test -p markdowner-core settings --all-features
git diff --check
```

Expected: `package.json`, Tauri, Cargo, and lockfile versions match `VERSION`.

- [ ] **Step 4: Commit and publish synchronized metadata**

Run:

```bash
release_version="$(tr -d '[:space:]' < VERSION)"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
git commit -m "chore(release): sync app versions for v${release_version}"
git push origin main
git push origin "v${release_version}"
git fetch origin --tags
```

Expected: normal pushes succeed without force.

- [ ] **Step 5: Rebuild, reinstall, and prove final parity**

Run `pnpm build:install`, repeat version/signature/architecture/hash checks, and then run:

```bash
release_version="$(tr -d '[:space:]' < VERSION)"
git status --short --branch
git rev-list --left-right --count HEAD...@{upstream}
git rev-list --left-right --count HEAD...origin/main
git rev-parse HEAD
git rev-parse @{upstream}
git rev-parse origin/main
git ls-remote --tags origin "v${release_version}"
```

Expected: clean worktree, both parity checks `0 0`, identical branch hashes, and the remote annotated tag present.
