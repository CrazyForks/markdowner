# AI Feature v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-request AI Workbench with a persistent AI Feature
that provides scope selection, global activity, paginated local history,
interactive PRD interviews, and resumable structure-aware translation.

**Architecture:** Rust owns the authoritative AI runtime, scheduler, translation
and interview orchestration, plus a bounded SQLite history store. React renders
the `New`, `Activity`, and `History` read models through Tauri commands and
events; all apply operations continue through the existing guarded AI Review
flow.

**Tech Stack:** Rust 2024, Tauri 2, Tokio, Reqwest SSE, rusqlite 0.40.1 with
bundled SQLite, React 19, TypeScript, Vitest, Testing Library, Tailwind CSS

---

## Scope and Execution Order

This plan implements the AI subsystem of the approved
`2026-08-01-ai-feature-document-intelligence-prd.md`. Obsidian front matter is
independent and is planned in
`2026-08-02-obsidian-frontmatter-wysiwyg.md`. Complete this plan first so the
front matter plan can reuse the final document-protection contract.

The repository instruction forbids subagent dispatch, so execute this plan
inline with `executing-plans`. Every task is a tested, pushed checkpoint.

## File Responsibility Map

### Rust backend

- Create `src-tauri/src/ai/history.rs`: SQLite migrations, run/turn/chunk
  persistence, retention, pagination, deletion, interrupted recovery.
- Create `src-tauri/src/ai/activity.rs`: authoritative active-request snapshots
  and progress transitions.
- Create `src-tauri/src/ai/chunking.rs`: Markdown-aware translation chunk plans,
  subdivision, validated merge, resume metadata.
- Create `src-tauri/src/ai/interview.rs`: PRD interview state transitions and
  versioned prompt recipes.
- Create `src-tauri/src/ai/scope.rs`: document and workspace scope validation,
  bounded workspace context, source fingerprints.
- Modify `src-tauri/src/ai/mod.rs`: compose the modules in `AiState`, expose
  commands, and delegate orchestration.
- Modify `src-tauri/src/ai/openrouter.rs`: capture `finish_reason`, support
  interview prompts, and surface truncation without leaking content.
- Modify `src-tauri/src/lib.rs`: register the new Tauri commands.
- Modify `src-tauri/Cargo.toml`: add bundled `rusqlite`.
- Modify `crates/markdowner-core/src/ai_document.rs`: expose deterministic
  section boundaries and merge helpers without moving network concerns into
  the core crate.

### Frontend

- Rename `src/features/ai/AiWorkbenchPanel.tsx` to
  `src/features/ai/AiFeaturePanel.tsx`: tab shell and New workflow.
- Rename `src/features/ai/AiWorkbenchPanel.test.tsx` to
  `src/features/ai/AiFeaturePanel.test.tsx`: integrated panel contracts.
- Create `src/features/ai/AiActivityTab.tsx`: live active-request list.
- Create `src/features/ai/AiHistoryTab.tsx`: 20-row pages, details, delete and
  clear actions.
- Create `src/features/ai/AiPrdInterview.tsx`: one-question interaction,
  resume, edit, skip and explicit finish.
- Create `src/features/ai/AiScopePicker.tsx`: automatic current-document,
  alternate document and workspace selection.
- Create `src/features/ai/useAiRuntime.ts`: command/event synchronization for
  active requests and history invalidation.
- Modify `src/features/ai/types.ts`: shared request, scope, activity, history,
  interview, chunk and multi-document result contracts.
- Modify `src/lib/desktop.ts`: typed Tauri adapters.
- Modify `src/lib/settings.ts` and
  `crates/markdowner-core/src/settings.rs`: default scope and local-history
  settings with legacy normalization.
- Modify `src/features/ai/OpenRouterSettings.tsx` and
  `src/shell/SettingsPanel.tsx`: dedicated AI Feature settings groups.
- Modify `src/lib/keymap.ts`, `src/lib/keyboardShortcuts.ts`,
  `src/shell/commandPaletteCommands.ts`, `src/shell/ActivityBar.tsx`,
  `src/shell/ShortcutsDialog.tsx`, `src/shell/SideBar.tsx`, and `src/App.tsx`:
  shared toggle command and naming.
- Modify `src/features/ai/AiReviewTab.tsx`, `src/features/ai/review.ts`, and
  `src/lib/documentTabs.ts`: file-grouped workspace translation reviews.
- Modify `src/styles.css`: compact tabs, status rail, activity/history rows,
  interview and dedicated settings layout.

## Task 1: Add the bounded SQLite history store

**Files:**

- Create: `src-tauri/src/ai/history.rs`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/ai/history.rs`

- [ ] **Step 1: Add failing migration, pagination, retention, and recovery tests**

Add tests using `tempfile::TempDir` and a real SQLite file:

```rust
#[test]
fn history_migrates_pages_prunes_and_recovers_interrupted_runs() {
    let directory = tempfile::tempdir().unwrap();
    let store = HistoryStore::open(&directory.path().join("history.sqlite3")).unwrap();

    for index in 0..505 {
        let id = format!("run-{index:03}");
        store.insert_run(&fixture_run(&id, index as i64)).unwrap();
        store.finish_run(&id, RunStatus::Completed, None, None).unwrap();
    }

    let first = store.page(0, 20).unwrap();
    assert_eq!(first.total, 500);
    assert_eq!(first.items.len(), 20);
    assert_eq!(first.items[0].id, "run-504");
    assert!(store.detail("run-000").unwrap().is_none());

    store.insert_run(&fixture_run("running", 999)).unwrap();
    drop(store);
    let reopened = HistoryStore::open(&directory.path().join("history.sqlite3")).unwrap();
    assert_eq!(
        reopened.detail("running").unwrap().unwrap().status,
        RunStatus::Interrupted,
    );
}
```

Add a migration-failure test proving `AiState` still constructs with history
marked unavailable, ordinary editing commands remain usable, and history
commands return a typed `history_unavailable` error. A corrupt or locked
history database must not prevent the editor from launching.

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run:

```bash
cargo test -p markdowner-desktop --lib ai::history::tests -- --nocapture
```

Expected: compilation fails because `ai::history` and `HistoryStore` do not
exist.

- [ ] **Step 3: Add rusqlite and implement the store**

Run:

```bash
cargo add rusqlite@0.40.1 --features bundled --manifest-path src-tauri/Cargo.toml
```

Implement these public contracts in `history.rs`:

```rust
pub const HISTORY_PAGE_SIZE: u32 = 20;
pub const HISTORY_RETENTION: u32 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRun {
    pub id: String,
    pub task: AiTask,
    pub model: String,
    pub status: RunStatus,
    pub scope_json: String,
    pub source_hash: String,
    pub prompt_version: String,
    pub result_json: Option<String>,
    pub error_json: Option<String>,
    pub usage_json: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub items: Vec<StoredRun>,
    pub page: u32,
    pub page_size: u32,
    pub total: u32,
}

pub struct HistoryStore {
    path: PathBuf,
}

impl HistoryStore {
    pub fn open(path: &Path) -> Result<Self, AiError>;
    pub fn insert_run(&self, run: &StoredRun) -> Result<(), AiError>;
    pub fn finish_run(
        &self,
        id: &str,
        status: RunStatus,
        result_json: Option<&str>,
        error_json: Option<&str>,
    ) -> Result<(), AiError>;
    pub fn page(&self, page: u32, page_size: u32) -> Result<HistoryPage, AiError>;
    pub fn detail(&self, id: &str) -> Result<Option<StoredRun>, AiError>;
    pub fn delete(&self, id: &str) -> Result<bool, AiError>;
    pub fn clear(&self) -> Result<u32, AiError>;
}
```

Migration 1 creates `ai_runs`, `ai_interview_turns`,
`ai_translation_chunks`, and `ai_schema_migrations`. `open` changes leftover
`running` rows to `interrupted`. `finish_run` and pruning run in the same
transaction. Clamp requested page size to `1..=20`.

Wrap the store in an availability state owned by `AiState`. Isolate migration
or open failure to History and resume commands; keep New, Activity, and the
rest of Markdowner operational. Never delete or recreate a failed database
automatically.

- [ ] **Step 4: Run focused and module tests and verify GREEN**

Run:

```bash
cargo test -p markdowner-desktop --lib ai::history -- --nocapture
cargo fmt --all -- --check
```

Expected: history tests pass and formatting is clean.

- [ ] **Step 5: Commit and push the history checkpoint**

```bash
git add src-tauri/Cargo.toml Cargo.lock src-tauri/src/ai/history.rs \
  src-tauri/src/ai/mod.rs
git commit -m "feat(ai-history): add bounded local run store"
git push origin main
```

## Task 2: Make activity state authoritative in Rust

**Files:**

- Create: `src-tauri/src/ai/activity.rs`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/ai/activity.rs`
- Test: `src-tauri/src/ai/mod.rs`

- [ ] **Step 1: Write failing state-transition tests**

```rust
#[test]
fn registry_reports_progress_and_terminal_removal() {
    let registry = ActivityRegistry::default();
    registry.start(fixture_activity("run-1")).unwrap();
    registry
        .progress("run-1", ActivityProgress::translation(2, 5, 3, 8, "Architecture"))
        .unwrap();

    let active = registry.list().unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].progress.chunk_completed, Some(3));
    assert_eq!(active[0].progress.label.as_deref(), Some("Architecture"));

    registry.finish("run-1").unwrap();
    assert!(registry.list().unwrap().is_empty());
}
```

Also add a scheduler test proving a batch reserves one app slot and rejects
overlap with any document already active. Assert `list()` is ordered by start
time and retains every active request when the panel is unmounted.

- [ ] **Step 2: Run tests and verify RED**

```bash
cargo test -p markdowner-desktop --lib ai::activity -- --nocapture
cargo test -p markdowner-desktop --lib \
  ai::tests::limits_two_app_requests_and_one_per_document -- --nocapture
```

Expected: missing `ActivityRegistry`, `ActivityProgress`, and scoped scheduler
APIs.

- [ ] **Step 3: Implement activity snapshots and scoped permits**

Use these serialized contracts:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAiRun {
    pub request_id: String,
    pub task: AiTask,
    pub model: String,
    pub scope: AiRunScope,
    pub status: ActiveStatus,
    pub progress: ActivityProgress,
    pub started_at: i64,
    pub cancelable: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityProgress {
    pub stage: String,
    pub file_completed: Option<u32>,
    pub file_total: Option<u32>,
    pub chunk_completed: Option<u32>,
    pub chunk_total: Option<u32>,
    pub label: Option<String>,
    pub received_characters: usize,
}
```

Change `RequestScheduler::acquire` to accept a non-empty `&[String]`, reject
any overlapping document ID, and remove every reservation when the permit
drops. Keep the existing maximum of two app permits.

Expose `ai_list_active` and update `ai_cancel` to change status to
`cancelling` before triggering the token.

- [ ] **Step 4: Verify activity and existing AI tests**

```bash
cargo test -p markdowner-desktop --lib ai -- --nocapture
```

Expected: existing scheduler, OpenRouter, validation, and new activity tests
all pass.

- [ ] **Step 5: Commit and push**

```bash
git add src-tauri/src/ai/activity.rs src-tauri/src/ai/mod.rs src-tauri/src/lib.rs
git commit -m "feat(ai-runtime): expose global request activity"
git push origin main
```

## Task 3: Rename the surface and add the shared toggle command

**Files:**

- Rename: `src/features/ai/AiWorkbenchPanel.tsx` to
  `src/features/ai/AiFeaturePanel.tsx`
- Rename: `src/features/ai/AiWorkbenchPanel.test.tsx` to
  `src/features/ai/AiFeaturePanel.test.tsx`
- Modify: `src/lib/keymap.ts`
- Modify: `src/lib/keyboardShortcuts.ts`
- Modify: `src/lib/keyboardShortcuts.test.ts`
- Modify: `src/shell/commandPaletteCommands.ts`
- Modify: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/shell/ShortcutsDialog.test.tsx`
- Modify: `src/shell/ActivityBar.tsx`
- Modify: `src/shell/SideBar.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`
- Test: `src/features/ai/AiSelectionPopover.test.tsx`

- [ ] **Step 1: Write failing shortcut, Palette, label, and App tests**

Add the expected shell action:

```ts
expect(
  resolveShellShortcutAction(
    shortcutEvent({ key: 'A', metaKey: true, shiftKey: true }),
    context,
  ),
).toEqual({ kind: 'toggleAiFeature' });
```

Add a Palette contract:

```ts
const command = commands.find((item) => item.id === 'view.toggleAiFeature');
expect(command).toMatchObject({
  category: 'View',
  label: 'View: Toggle AI Feature',
  shortcut: '⌘⇧A',
});
command?.run();
expect(actions.toggleAiFeature).toHaveBeenCalledTimes(1);
```

Add App assertions that the shortcut opens the AI sidebar, pressing it again
closes the sidebar, and `AI Workbench` is absent from rendered labels. Open
Show Keyboard Shortcuts and assert the View section renders
`Toggle AI Feature` with `⌘⇧A`.

Keep the existing drag-selection entry point as a regression contract: a
captured source range must still open the prompt UI and run task `custom`
against that immutable range.

- [ ] **Step 2: Run focused frontend tests and verify RED**

```bash
pnpm exec vitest run src/lib/keyboardShortcuts.test.ts \
  src/shell/commandPaletteCommands.test.ts \
  src/shell/ShortcutsDialog.test.tsx \
  src/features/ai/AiSelectionPopover.test.tsx \
  src/features/ai/AiFeaturePanel.test.tsx \
  src/App.test.tsx --maxWorkers=1
```

Expected: missing action, command, renamed component, and labels.

- [ ] **Step 3: Implement one command contract**

Add `view.toggleAiFeature` to `ShellCommandId`, default it to
`{ key: 'a', shift: true }`, add the View keymap row, and return
`{ kind: 'toggleAiFeature' }` from the shortcut resolver.

Add `toggleAiFeature` to `CommandPaletteActions` and this command:

```ts
{
  id: 'view.toggleAiFeature',
  category: 'View',
  label: 'View: Toggle AI Feature',
  shortcut: '⌘⇧A',
  run: actions.toggleAiFeature,
}
```

Create one `toggleAiFeature` callback in `App.tsx` that toggles the sidebar
when AI is already visible and otherwise opens it. Route the Activity Bar,
shortcut switch and Palette action through the callback. Rename component,
visible heading, aria labels, rerun announcement, title, and test IDs to
`AI Feature` / `ai-feature-*`. Add the View keymap row so ShortcutsDialog uses
the same registry entry rather than a second hard-coded shortcut.

- [ ] **Step 4: Verify targeted tests and typecheck**

```bash
pnpm exec vitest run src/lib/keyboardShortcuts.test.ts \
  src/shell/commandPaletteCommands.test.ts \
  src/shell/ShortcutsDialog.test.tsx \
  src/features/ai/AiSelectionPopover.test.tsx \
  src/features/ai/AiFeaturePanel.test.tsx \
  src/App.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
```

Expected: tests and TypeScript pass; `rg -n "AI Workbench" src` only finds
intentional migration comments or no matches.

- [ ] **Step 5: Commit and push**

```bash
git add src/features/ai src/lib/keymap.ts src/lib/keyboardShortcuts.ts \
  src/lib/keyboardShortcuts.test.ts src/shell/commandPaletteCommands.ts \
  src/shell/commandPaletteCommands.test.ts src/shell/ActivityBar.tsx \
  src/shell/ShortcutsDialog.test.tsx src/shell/SideBar.tsx src/App.tsx \
  src/App.test.tsx
git commit -m "feat(ai-ui): rename and toggle AI Feature"
git push origin main
```

## Task 4: Add typed scopes and dedicated settings

**Files:**

- Create: `src/features/ai/AiScopePicker.tsx`
- Create: `src/features/ai/AiScopePicker.test.tsx`
- Modify: `src/features/ai/types.ts`
- Modify: `src/features/ai/model.ts`
- Modify: `src/features/ai/model.test.ts`
- Modify: `src/features/ai/AiFeaturePanel.tsx`
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/settings.test.ts`
- Modify: `crates/markdowner-core/src/settings.rs`
- Modify: `src/features/ai/OpenRouterSettings.tsx`
- Modify: `src/features/ai/OpenRouterSettings.test.tsx`
- Modify: `src/shell/SettingsPanel.tsx`
- Modify: `src/shell/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing scope and settings normalization tests**

Use this frontend contract:

```ts
export interface AiDocumentRef {
  documentId: string;
  path: string | null;
  label: string;
}

export type AiRunScope =
  | { kind: 'document'; target: AiDocumentRef }
  | {
      kind: 'workspace';
      rootPath: string;
      target: AiDocumentRef | null;
      documentCount: number;
    };
```

Test that the picker starts on the current document, can choose another
document, and can choose workspace only when a root exists. Test legacy
settings normalize to:

```ts
expect(normalizeSettings({}).aiDefaultScope).toBe('document');
expect(normalizeSettings({}).aiHistoryEnabled).toBe(true);
```

For translation, workspace scope has `target: null` and means sequential
batch. For PRD and custom prompt, workspace scope requires one target document
and means bounded read-only context around that target.

Lock the model policy with regression assertions:

```ts
expect(DEFAULT_AI_MODEL).toBe('z-ai/glm-5.2');
expect(PINNED_AI_MODELS).toEqual([
  'z-ai/glm-5.2',
  'moonshotai/kimi-k3',
]);
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm exec vitest run src/features/ai/AiScopePicker.test.tsx \
  src/features/ai/model.test.ts \
  src/features/ai/OpenRouterSettings.test.tsx src/lib/settings.test.ts \
  src/shell/SettingsPanel.test.tsx --maxWorkers=1
cargo test -p markdowner-core settings -- --nocapture
```

Expected: missing scope component and settings fields.

- [ ] **Step 3: Implement scope and settings contracts**

Add these settings on both TypeScript and Rust sides:

```ts
aiDefaultScope: 'document' | 'workspace';
aiHistoryEnabled: boolean;
```

Defaults are `document` and `true`; invalid legacy values normalize to those
defaults. Do not store selected document IDs in settings.

`AiScopePicker` receives current document, open documents, workspace root,
workspace file count, task, and `onChange`. Its label is `Scope`; options show
relative path when available. In PRD/custom workspace mode, show a separate
Target document control and default it to the current document. In translation
workspace mode, label the choice as a sequential Markdown batch.
`AiFeaturePanel` resets an unavailable saved workspace default to the current
document.

Restructure Settings navigation into a dedicated AI Feature item with three
grouped regions: `OpenRouter Connection`, `Task Defaults`, and
`History & Privacy`.
Keep the key input owned by `OpenRouterSettings`; pass the new defaults as
controlled props rather than duplicating credential state. Every task defaults
to GLM-5.2 for a new or invalid legacy setting, Kimi K3 remains selectable, and
an unavailable model produces a user-facing retry choice without mutating the
saved or current selection.

- [ ] **Step 4: Verify settings and scope tests**

```bash
pnpm exec vitest run src/features/ai/AiScopePicker.test.tsx \
  src/features/ai/model.test.ts \
  src/features/ai/OpenRouterSettings.test.tsx src/lib/settings.test.ts \
  src/shell/SettingsPanel.test.tsx --maxWorkers=1
cargo test -p markdowner-core settings -- --nocapture
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit and push**

```bash
git add src/features/ai src/lib/settings.ts src/lib/settings.test.ts \
  crates/markdowner-core/src/settings.rs src/shell/SettingsPanel.tsx \
  src/shell/SettingsPanel.test.tsx
git commit -m "feat(ai-settings): add scope and history defaults"
git push origin main
```

## Task 5: Expose typed activity and history commands to React

**Files:**

- Modify: `src/features/ai/types.ts`
- Create: `src/features/ai/useAiRuntime.ts`
- Create: `src/features/ai/useAiRuntime.test.tsx`
- Create: `src/features/ai/AiActivityTab.tsx`
- Create: `src/features/ai/AiActivityTab.test.tsx`
- Create: `src/features/ai/AiHistoryTab.tsx`
- Create: `src/features/ai/AiHistoryTab.test.tsx`
- Modify: `src/features/ai/AiFeaturePanel.tsx`
- Modify: `src/lib/desktop.ts`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing hook and view tests**

Define matching frontend read models:

```ts
export type AiFeatureTab = 'new' | 'activity' | 'history';

export interface AiActiveRun {
  requestId: string;
  task: AiTask;
  model: string;
  scope: AiRunScope;
  status: 'queued' | 'running' | 'cancelling';
  progress: AiActivityProgress;
  startedAt: number;
  cancelable: boolean;
}

export interface AiHistoryPage {
  items: AiHistorySummary[];
  page: number;
  pageSize: 20;
  total: number;
}
```

Test one running translation renders `3 / 8`, heading, model and Cancel. Test
history page navigation requests page 1 after Next, opens a detail, deletes a
record after confirmation, and exposes Clear history. Detail assertions cover
task, model, status, scope, question/answer turns, validated result, error,
prompt/completion usage, cost, and duration while proving full source content
is absent.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm exec vitest run src/features/ai/useAiRuntime.test.tsx \
  src/features/ai/AiActivityTab.test.tsx \
  src/features/ai/AiHistoryTab.test.tsx --maxWorkers=1
```

Expected: components, hook, and desktop commands are missing.

- [ ] **Step 3: Add commands and runtime synchronization**

Expose these Rust commands:

```text
ai_list_active
ai_history_page(page, page_size)
ai_history_detail(request_id)
ai_history_delete(request_id)
ai_history_clear
```

Add typed adapters in `desktop.ts`. `useAiRuntime` loads an initial snapshot,
listens to `markdowner://ai-activity-changed` and
`markdowner://ai-history-changed`, then reloads only the invalidated read
model. Return cleanup functions from both listeners.

`AiFeaturePanel` renders a three-button tablist, includes the running count in
the Activity tab, and shows a compact status rail on New when any run exists.
Do not keep a second local `runningRequestId`; derive it from the backend
snapshot.

- [ ] **Step 4: Verify frontend and Rust command tests**

```bash
pnpm exec vitest run src/features/ai/useAiRuntime.test.tsx \
  src/features/ai/AiActivityTab.test.tsx \
  src/features/ai/AiHistoryTab.test.tsx \
  src/features/ai/AiFeaturePanel.test.tsx --maxWorkers=1
cargo test -p markdowner-desktop --lib ai -- --nocapture
```

Expected: all targeted suites pass.

- [ ] **Step 5: Commit and push**

```bash
git add src/features/ai src/lib/desktop.ts src-tauri/src/ai \
  src-tauri/src/lib.rs src/styles.css
git commit -m "feat(ai-ui): add activity and history tabs"
git push origin main
```

## Task 6: Persist and orchestrate one-question PRD interviews

**Files:**

- Create: `src-tauri/src/ai/interview.rs`
- Modify: `src-tauri/src/ai/history.rs`
- Modify: `src-tauri/src/ai/openrouter.rs`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/ai/interview.rs`
- Test: `src-tauri/src/ai/openrouter.rs`

- [ ] **Step 1: Write failing interview transition and prompt tests**

```rust
#[test]
fn interview_never_finishes_without_explicit_user_intent() {
    let mut session = fixture_session();
    session.apply_model_turn(ModelTurn {
        question: "What is the success threshold?".into(),
        remaining_areas: vec![],
        ..fixture_model_turn()
    });
    assert_eq!(session.status, InterviewStatus::AwaitingAnswer);

    session.answer("Enough for now", true).unwrap();
    assert_eq!(session.status, InterviewStatus::ReadyToGenerate);
}

#[test]
fn interview_prompt_contains_history_as_data_and_no_tools() {
    let request = build_interview_request(&fixture_session(), &fixture_context());
    let body = build_chat_request(&request);
    assert!(body.get("tools").is_none());
    assert_eq!(body["metadata"]["prompt_version"], "2026-08-02.prd-interview.v1");
    assert!(body["messages"][1]["content"].as_str().unwrap().contains("<interview_history>"));
}
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cargo test -p markdowner-desktop --lib ai::interview -- --nocapture
cargo test -p markdowner-desktop --lib ai::openrouter::tests::interview -- --nocapture
```

Expected: interview module, request task, and prompt recipe are missing.

- [ ] **Step 3: Implement state, persistence, schema, and commands**

Implement:

```rust
pub const PRD_INTERVIEW_PROMPT_VERSION: &str = "2026-08-02.prd-interview.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterviewStatus {
    AwaitingModel,
    AwaitingAnswer,
    ReadyToGenerate,
    Generating,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewTurn {
    pub id: String,
    pub question: String,
    pub rationale: String,
    pub unresolved_area: String,
    pub answer: Option<String>,
    pub skipped: bool,
}
```

Add commands `ai_interview_start`, `ai_interview_answer`,
`ai_interview_update_answer`, `ai_interview_skip`,
`ai_interview_finish`, and `ai_interview_resume`. Persist each transition in
one SQLite transaction. `finish` is the only route to the final PRD operation
schema; an empty `remaining_areas` never triggers it.

Use the approved Superpowers-style one-question sequencing and grilling-style
gap pressure as versioned system text. Treat document, context, questions and
answers as delimited data. Expose no tools.

- [ ] **Step 4: Verify backend interview and AI suites**

```bash
cargo test -p markdowner-desktop --lib ai::interview -- --nocapture
cargo test -p markdowner-desktop --lib ai -- --nocapture
```

Expected: transitions, persistence, redaction, and existing AI tests pass.

- [ ] **Step 5: Commit and push**

```bash
git add src-tauri/src/ai src-tauri/src/lib.rs
git commit -m "feat(ai-prd): add persistent interview orchestration"
git push origin main
```

## Task 7: Build the PRD interview UI

**Files:**

- Create: `src/features/ai/AiPrdInterview.tsx`
- Create: `src/features/ai/AiPrdInterview.test.tsx`
- Modify: `src/features/ai/AiFeaturePanel.tsx`
- Modify: `src/features/ai/types.ts`
- Modify: `src/lib/desktop.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing user-flow tests**

Test this sequence with mocked services:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Start PRD interview' }));
expect(await screen.findByText('Who is the primary user?')).toBeVisible();
fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), {
  target: { value: 'Product managers in Korean startups.' },
});
fireEvent.click(screen.getByRole('button', { name: 'Continue interview' }));
expect(services.answerInterview).toHaveBeenCalledWith(
  expect.objectContaining({ answer: 'Product managers in Korean startups.' }),
);
fireEvent.click(screen.getByRole('button', { name: 'Enough — Generate PRD' }));
expect(await screen.findByRole('dialog', { name: 'Finish PRD interview?' })).toBeVisible();
```

Also test edit, skip, resume after remount, loading, error, keyboard submit, and
that the finish button is never invoked by a model response alone.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run src/features/ai/AiPrdInterview.test.tsx \
  src/features/ai/AiFeaturePanel.test.tsx --maxWorkers=1
```

Expected: missing component and typed interview services.

- [ ] **Step 3: Implement the interview view**

Render one current question, rationale, prior answers in a collapsible list,
answer textarea, Skip, Continue, and `Enough — Generate PRD`. Recognize typed
`충분합니다` or `enough` as finish intent, but always show the same explicit
confirmation dialog before calling `finishInterview`.

On completion, forward the returned `AiRunResult` through the existing
`onResult` callback so Review remains the only application surface. Add
`aria-live="polite"` for question changes and `aria-busy` while waiting.

- [ ] **Step 4: Verify UI, App integration, and typecheck**

```bash
pnpm exec vitest run src/features/ai/AiPrdInterview.test.tsx \
  src/features/ai/AiFeaturePanel.test.tsx src/App.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit and push**

```bash
git add src/features/ai src/lib/desktop.ts src/styles.css
git commit -m "feat(ai-prd): add guided interview workflow"
git push origin main
```

## Task 8: Detect truncation and plan Markdown-aware translation chunks

**Files:**

- Create: `src-tauri/src/ai/chunking.rs`
- Modify: `src-tauri/src/ai/openrouter.rs`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `crates/markdowner-core/src/ai_document.rs`
- Test: `src-tauri/src/ai/chunking.rs`
- Test: `src-tauri/src/ai/openrouter.rs`
- Test: `crates/markdowner-core/src/ai_document.rs`

- [ ] **Step 1: Add failing finish-reason and chunk-boundary tests**

```rust
#[test]
fn decoder_captures_length_finish_reason() {
    let mut decoder = SseDecoder::default();
    decoder
        .push(br#"data: {"choices":[{"delta":{"content":"{\"segments\":["},"finish_reason":"length"}]}\n\n"#)
        .unwrap();
    let complete = decoder.finish().unwrap();
    assert_eq!(complete.finish_reason.as_deref(), Some("length"));
}

#[test]
fn json_string_eof_is_classified_as_truncation() {
    let error = serde_json::from_str::<AiOperationEnvelope>(
        r#"{"operations":[{"replacement":"unfinished"#,
    )
    .unwrap_err();
    assert!(error.to_string().contains("EOF while parsing a string"));
    assert_eq!(classify_schema_error(&error), SchemaFailure::ResponseTruncated);
}

#[test]
fn chunk_plan_preserves_headings_tables_and_fences() {
    let source = include_str!("../../../tests/fixtures/ai/long-translation.md");
    let chunks = plan_translation_chunks(source, 800).unwrap();
    assert!(chunks.len() > 2);
    assert!(chunks.iter().all(|chunk| balanced_fences(&chunk.source)));
    assert_eq!(chunks.concat_source(), source);
}
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cargo test -p markdowner-desktop --lib \
  ai::openrouter::tests::decoder_captures_length -- --nocapture
cargo test -p markdowner-desktop --lib ai::chunking -- --nocapture
cargo test -p markdowner-core ai_document -- --nocapture
```

Expected: no finish reason and no chunk planner.

- [ ] **Step 3: Implement finish reason, chunk planning, and subdivision**

Extend `SseComplete` with `finish_reason: Option<String>` and record the last
non-null `/choices/0/finish_reason`.

Implement:

```rust
pub struct TranslationChunk {
    pub index: u32,
    pub source_range: Range<usize>,
    pub source: String,
    pub heading: Option<String>,
    pub estimated_input_tokens: u32,
}

pub fn plan_translation_chunks(
    source: &str,
    max_estimated_tokens: u32,
) -> Result<Vec<TranslationChunk>, AiError>;

pub fn subdivide_translation_chunk(
    chunk: &TranslationChunk,
) -> Result<Vec<TranslationChunk>, AiError>;
```

Use core-provided block ranges. Prefer heading sections, then paragraphs and
list/table blocks. Never split UTF-8, fenced code, a table row, or front matter
syntax. An oversized single text block may split only at sentence or newline
boundaries.

Classify either `finish_reason == "length"` or a serde JSON EOF as
`response_truncated`, including the exact `EOF while parsing a string` local
validation failure. Retry by subdivision up to three levels; never call
response healing for streaming output. Provider/model unavailable errors keep
the selected model and offer GLM-5.2 and Kimi K3 as explicit user retry
choices; orchestration must never change the model automatically.

- [ ] **Step 4: Verify truncation and structure tests**

```bash
cargo test -p markdowner-desktop --lib ai::chunking -- --nocapture
cargo test -p markdowner-desktop --lib ai::openrouter -- --nocapture
cargo test -p markdowner-core ai_document -- --nocapture
```

Expected: tests pass, including the original mid-string EOF fixture.

- [ ] **Step 5: Commit and push**

```bash
git add src-tauri/src/ai crates/markdowner-core/src/ai_document.rs \
  tests/fixtures/ai/long-translation.md
git commit -m "fix(ai-translation): recover from truncated structured output"
git push origin main
```

## Task 9: Add resumable document and workspace translation orchestration

**Files:**

- Create: `src-tauri/src/ai/scope.rs`
- Modify: `src-tauri/src/ai/chunking.rs`
- Modify: `src-tauri/src/ai/history.rs`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/ai/types.ts`
- Modify: `src/features/ai/AiFeaturePanel.tsx`
- Modify: `src/features/ai/AiActivityTab.tsx`
- Modify: `src/features/ai/AiReviewTab.tsx`
- Modify: `src/features/ai/review.ts`
- Modify: `src/lib/desktop.ts`
- Modify: `src/lib/documentTabs.ts`
- Test: corresponding Rust and TypeScript test files

- [ ] **Step 1: Write failing sequential, resume, stale, and grouped-review tests**

Backend sequence:

```rust
#[tokio::test]
async fn workspace_translation_resumes_at_first_incomplete_chunk() {
    let harness = TranslationHarness::new(vec![fixture_document("a.md"), fixture_document("b.md")]);
    harness.fail_chunk("b.md", 2, AiError::new("network_error", "offline"));
    let first = harness.run().await.unwrap_err();
    assert_eq!(first.resume.file_index, 1);
    assert_eq!(first.resume.chunk_index, 2);

    let resumed = harness.resume().await.unwrap();
    assert_eq!(resumed.documents.len(), 2);
    assert_eq!(harness.call_count("a.md"), 1);
}
```

Add backend cases proving cancel does not start another chunk, completed chunks
remain resumable after cancellation or rate limit, the provider retry time is
surfaced, and recursive subdivision exhaustion returns the first incomplete
chunk. Frontend tests assert file-level Review controls and that only a stale
file is blocked when another file still matches its source hash.

- [ ] **Step 2: Run targeted tests and verify RED**

```bash
cargo test -p markdowner-desktop --lib ai::scope -- --nocapture
cargo test -p markdowner-desktop --lib ai::chunking -- --nocapture
pnpm exec vitest run src/features/ai/AiReviewTab.test.tsx \
  src/features/ai/AiFeaturePanel.test.tsx --maxWorkers=1
```

Expected: no workspace source contract, resume command, or grouped result.

- [ ] **Step 3: Implement bounded scope and sequential orchestration**

Use this request source contract:

```ts
export interface AiSourceDocument {
  documentId: string;
  path: string | null;
  label: string;
  source: string;
  sourceRevisionHash: string;
}

export interface AiRunRequest {
  requestId: string;
  scope: AiRunScope;
  documents: AiSourceDocument[];
  task: AiTask;
  model: string;
  targetLanguage: string | null;
  instruction: string | null;
  zdrOnly: boolean;
  maxOutputTokens: number;
}
```

For translation, validate every file against the ignore policy and 50,000
token per-document cap, reserve all document IDs, then process files and
chunks sequentially. Persist each validated chunk without raw source.
`ai_run_resume` reloads chunk output only when every source hash still matches.

Before confirmation, compute and render target file count, estimated input
tokens, planned chunk count, and maximum cost for both document and workspace
scope. Refuse empty, unreadable, or over-limit scope with a reduction action.

For PRD/custom workspace context, send path and heading manifests plus bounded
relevant excerpts; never use every full workspace file. Expose the chosen
context files in the run scope summary.

Return `AiRunResult.documents[]`, each with its own validated document,
source hash, usage, status and issues. Keep selection requests compatible by
using one document entry.

- [ ] **Step 4: Verify backend, grouped Review, and App integration**

```bash
cargo test -p markdowner-desktop --lib ai -- --nocapture
pnpm exec vitest run src/features/ai/AiReviewTab.test.tsx \
  src/features/ai/AiFeaturePanel.test.tsx src/App.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
```

Expected: sequential calls, resume, stale guards and file-level Review pass.

- [ ] **Step 5: Commit and push**

```bash
git add src-tauri/src/ai src-tauri/src/lib.rs src/features/ai \
  src/lib/desktop.ts src/lib/documentTabs.ts src/App.tsx src/App.test.tsx
git commit -m "feat(ai-translation): add resumable workspace batches"
git push origin main
```

## Task 10: Complete accessibility, privacy, and regression gates

**Files:**

- Modify: `src/features/ai/telemetry.ts`
- Modify: `src/features/ai/telemetry.test.ts`
- Modify: `src/features/ai/AiFeaturePanel.test.tsx`
- Modify: `src/features/ai/AiActivityTab.test.tsx`
- Modify: `src/features/ai/AiHistoryTab.test.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`
- Modify: `src-tauri/src/ai/evaluation.rs`
- Modify: `tests/fixtures/ai/*`

- [ ] **Step 1: Add failing privacy and accessibility regression tests**

Assert analytics excludes filename, source, prompt, interview answers and AI
result. Assert status is exposed as text plus icon, active progress uses
`aria-live="polite"`, tab buttons use `role="tab"`, and destructive history
clear requires confirmation.

Add evaluation fixtures for large translation, interrupted resume, one-question
PRD, drag-selection custom prompts, and both pinned models without performing
network calls in deterministic CI. Assert a model-unavailable response never
changes the request model or task default.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm exec vitest run src/features/ai src/App.test.tsx --maxWorkers=1
cargo test -p markdowner-desktop --lib ai::evaluation -- --nocapture
```

Expected: missing final a11y attributes or fixtures fail first.

- [ ] **Step 3: Implement only the missing presentation and redaction behavior**

Use existing Geist typography and spacing tokens. Keep the panel dense, use a
single accent, no decorative badges, and a vertical layout at narrow widths.
Respect `prefers-reduced-motion`. Raw diagnostics remain collapsed, capped,
and redacted. Do not add analytics fields beyond task, model family, status,
duration bucket, token bucket and error code.

- [ ] **Step 4: Run the AI feature quality gate**

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace -- --nocapture
pnpm exec vitest run src/features/ai src/lib/keyboardShortcuts.test.ts \
  src/shell/commandPaletteCommands.test.ts \
  src/shell/ShortcutsDialog.test.tsx src/shell/SettingsPanel.test.tsx \
  src/App.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
pnpm build
```

Expected: every command exits 0. Record unavailable real OpenRouter proof
separately; do not claim it from mock tests.

- [ ] **Step 5: Commit and push**

```bash
git add src src-tauri/src tests/fixtures/ai
git commit -m "test(ai): close AI Feature v2 quality gates"
git push origin main
git fetch origin
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0` and a clean worktree.

## Plan Self-Review

- Spec coverage: naming, shortcut, Palette, shortcut help, scope, Settings,
  activity, history, 500/20 retention, interview, explicit finish, truncation,
  exact JSON string EOF, chunk progress, resume, workspace behavior,
  drag-selection custom prompt, stale apply, privacy and no-fallback model
  policy each map to a task above.
- Type consistency: `AiRunScope`, `AiSourceDocument`, `AiActiveRun`,
  `AiHistoryPage`, `RunStatus`, and `ActivityProgress` are defined before their
  first cross-layer use.
- No unresolved implementation placeholders remain. Network proof is an
  explicit release-time environmental gate, not an omitted implementation.
