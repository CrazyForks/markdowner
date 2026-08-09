# WYSIWYG AI Selection and Local Agent Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn selected WYSIWYG text into preset OpenRouter actions and add safe `@claude`, `@codex`, and `@opencode` content transformations that Markdowner alone validates and applies.

**Architecture:** Keep OpenRouter presets on the existing `AiSelectionPopover` path. Add a separate frontend local-agent domain for mention discovery, target snapshots, the composer, and Review normalization; back it with three fixed Rust CLI adapters that run in owned temporary directories with tools disabled, bounded I/O, cancellation, and fail-closed capability probes. Reuse the current exact-range application and AI Review behavior rather than allowing any CLI to edit the workspace or saved file.

**Tech Stack:** React 19, TypeScript 5, Tiptap 3/ProseMirror, CodeMirror 6, Vitest/Testing Library, Tauri 2 IPC channels, Rust 2024, Tokio, tempfile, serde/serde_json.

## Global Constraints

- Fixed local agent registry only: `claude`, `codex`, and `opencode`; no user executable paths, flags, models, or custom agents.
- The CLI working directory is an unpredictable user-only temporary directory, never the document or workspace directory.
- The CLI receives the captured Markdown snapshot but never the document path.
- No direct file editing, shell, browser, web-search tool, MCP, plugin, app, memory, skill, or subagent capability is allowed in an embedded run.
- A local-agent adapter is disabled unless its installed CLI proves every required restriction; unknown enabled Codex capabilities fail closed.
- OpenRouter consent gates OpenRouter actions; `localAgentDisclosureAccepted` separately gates local-agent runs.
- A provider-backed request starts only after an explicit Run click.
- `insert` and `selection` apply only to an unchanged captured snapshot in one editor transaction; `document` always opens Review first.
- Local-agent prompts, snapshots, and results never enter OpenRouter History or diagnostics.
- Limits are exact: source at most 2 MiB UTF-8, instruction at most 16 KiB UTF-8, stdout/result at most 2 MiB, stderr at most 64 KiB, capability probe timeout 5 seconds, run timeout 5 minutes.
- Automated tests use fake executables and make no paid Claude Code, Codex, OpenCode, or OpenRouter request.
- No app version bump, release artifact, tag, or pull request is part of this feature.

---

## File Structure

### Frontend files to create

- `src/features/ai/selectionActions.ts` — stable OpenRouter selected-text preset registry and prompt resolution.
- `src/features/ai/selectionActions.test.ts` — registry ordering and canonical prompt tests.
- `src/features/ai/localAgents/types.ts` — shared agent/status/request/result/event contracts matching Tauri camelCase serialization.
- `src/features/ai/localAgents/mentions.ts` — fixed mention registry, filtering, and safe WYSIWYG `@` boundary predicate.
- `src/features/ai/localAgents/mentions.test.ts` — mention ordering/filtering and boundary exclusions.
- `src/features/ai/localAgents/targets.ts` — source/WYSIWYG insert, selection, and document snapshots plus exact application and Review normalization.
- `src/features/ai/localAgents/targets.test.ts` — UTF-8, stale-target, insertion, replacement, and document-proposal tests.
- `src/features/ai/localAgents/LocalAgentComposer.tsx` — mention picker, prompt/target controls, disclosure gate, progress, cancel, and result callback.
- `src/features/ai/localAgents/LocalAgentComposer.test.tsx` — keyboard, disabled-status, disclosure, execution, cancel, and error UI tests.
- `src/features/ai/localAgents/LocalAgentSettings.tsx` — read-only installed/compatible agent status and disclosure settings.
- `src/features/ai/localAgents/LocalAgentSettings.test.tsx` — status, refresh, disclosure, and redaction tests.

### Rust files to create

- `src-tauri/src/local_agents/mod.rs` — public IPC types, error type, one-run registry, validation, `local_agent_statuses`, `local_agent_run`, and `local_agent_cancel`.
- `src-tauri/src/local_agents/discovery.rs` — allowlisted executable resolution, redacted labels, bounded capability probes, and fail-closed compatibility decisions.
- `src-tauri/src/local_agents/adapters.rs` — fixed argv/environment builders, shared prompt/schema, and Claude/Codex/OpenCode output parsing.
- `src-tauri/src/local_agents/process.rs` — bounded child I/O, timeout, cancellation, process-group termination, and owned temporary-directory lifecycle.

### Existing files to modify

- `src/features/ai/AiSelectionPopover.tsx` and test — preset buttons plus the local-agent handoff.
- `src/features/ai/review.ts`, `AiReviewTab.tsx`, and tests — local-agent origin metadata and no OpenRouter usage/cost display.
- `src/features/ai/selection.ts` and test only where the existing protected-range helper is reused; do not duplicate its OpenRouter result validator.
- `src/lib/desktop.ts` and test — Tauri wrappers for status/run/cancel using an IPC `Channel`.
- `src/lib/settings.ts` and test — persisted `localAgentDisclosureAccepted` defaulting to false.
- `crates/markdowner-core/src/settings.rs` — Rust settings default/deserialization/round trip for the new disclosure field.
- `src/components/wysiwyg/SelectionToolbar.tsx` and test — rename the entry point to `AI actions`.
- `src/shell/WysiwygEditorChrome.tsx` and test — retain callback threading for the selection entry point.
- `src/shell/commandPaletteCommands.ts` and test — add `Run local agent` for any open document.
- `src/shell/SettingsPanel.tsx` and test — mount local-agent settings below OpenRouter settings.
- `src/App.tsx` and `src/App.test.tsx` — stable `@` interception, snapshot capture, composer state, run result application, Review fallback, command-palette routing, and settings wiring.
- `src-tauri/Cargo.toml` — enable Tokio `process`/`io-util` features and add Unix process-group support dependency.
- `src-tauri/src/lib.rs` — expose login-shell PATH lookup to discovery, manage `LocalAgentState`, and register three commands.
- `crates/markdowner-core/src/ai_document.rs` — add one full-document replacement validator that restores protected placeholders and preserves Markdown structure.

---

### Task 1: Add deterministic selected-text quick actions

**Files:**
- Create: `src/features/ai/selectionActions.ts`
- Create: `src/features/ai/selectionActions.test.ts`
- Modify: `src/features/ai/AiSelectionPopover.tsx`
- Test: `src/features/ai/AiSelectionPopover.test.tsx`
- Modify: `src/components/wysiwyg/SelectionToolbar.tsx`
- Test: `src/components/wysiwyg/SelectionToolbar.test.tsx`

**Interfaces:**
- Produces: `SelectionActionId`, `SELECTION_ACTIONS`, and `resolveSelectionInstruction(actionId, customInstruction)`.
- Consumes: the existing `AiRunRequest` custom-selection path and `AiSelectionSnapshot` exact-range contract.

- [ ] **Step 1: Write the failing registry tests**

```ts
expect(SELECTION_ACTIONS.map((action) => action.id)).toEqual([
  'improve',
  'rewrite',
  'shorten',
  'expand',
  'make_table',
  'custom',
]);
expect(resolveSelectionInstruction('custom', '  Keep the links  ')).toBe(
  'Keep the links',
);
expect(resolveSelectionInstruction('custom', '   ')).toBeNull();
expect(resolveSelectionInstruction('make_table', '')).toContain(
  'Return exactly one valid GFM table',
);
```

- [ ] **Step 2: Run the tests and verify the missing module fails**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/selectionActions.test.ts`

Expected: FAIL because `selectionActions.ts` does not exist.

- [ ] **Step 3: Implement the immutable action registry**

```ts
export type SelectionActionId =
  | 'improve'
  | 'rewrite'
  | 'shorten'
  | 'expand'
  | 'make_table'
  | 'custom';

export interface SelectionAction {
  id: SelectionActionId;
  label: string;
  instruction: string | null;
}

export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  {
    id: 'improve',
    label: 'Improve',
    instruction:
      'Improve clarity, grammar, flow, and readability while preserving meaning, facts, language, links, and useful Markdown structure.',
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    instruction:
      'Rewrite substantially while preserving intent, supported facts, language, links, and Markdown semantics.',
  },
  {
    id: 'shorten',
    label: 'Shorten',
    instruction:
      'Make the selection concise without dropping essential facts, decisions, constraints, or links.',
  },
  {
    id: 'expand',
    label: 'Expand',
    instruction:
      'Add useful explanation from the selection and surrounding document context without inventing facts or commitments.',
  },
  {
    id: 'make_table',
    label: 'Make table',
    instruction:
      'Return exactly one valid GFM table with neutral headers and only facts supported by the selection. Leave missing source fields empty. Return no surrounding explanation.',
  },
  { id: 'custom', label: 'Custom instruction', instruction: null },
];

export function resolveSelectionInstruction(
  actionId: SelectionActionId,
  customInstruction: string,
): string | null {
  const action = SELECTION_ACTIONS.find((candidate) => candidate.id === actionId);
  if (action?.instruction) return action.instruction;
  const trimmed = customInstruction.trim();
  return trimmed.length > 0 ? trimmed : null;
}
```

- [ ] **Step 4: Test the popover interaction before changing it**

Add assertions that `Improve` is initially selected, choosing `Make table` sends its canonical instruction without an early request, choosing `Custom instruction` focuses the textarea, and `Use local agent` calls a new `onLocalAgent(snapshot)` prop without invoking OpenRouter.

```ts
expect(screen.getByRole('button', { name: 'Improve' })).toHaveAttribute(
  'aria-pressed',
  'true',
);
fireEvent.click(screen.getByRole('button', { name: 'Make table' }));
expect(run).not.toHaveBeenCalled();
fireEvent.click(screen.getByRole('button', { name: 'Use local agent' }));
expect(onLocalAgent).toHaveBeenCalledWith(snapshot);
expect(run).not.toHaveBeenCalled();
```

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/AiSelectionPopover.test.tsx src/components/wysiwyg/SelectionToolbar.test.tsx`

Expected: FAIL on missing preset controls, local-agent callback, and `AI actions` label.

- [ ] **Step 5: Render presets and preserve the existing OpenRouter request path**

Add `onLocalAgent: (snapshot: AiSelectionSnapshot) => void`, keep the model selector, set `instruction` from `resolveSelectionInstruction`, keep `task: 'custom'`, and change the toolbar label/title from `AI prompt` to `AI actions`. Selecting an action must only update local state; `handleRun` remains the only provider call.

```ts
const instruction = resolveSelectionInstruction(actionId, prompt);
const canRun =
  configured === true &&
  settings.aiCloudDisclosureAccepted &&
  instruction !== null &&
  selectedModel?.enabled === true &&
  !runningRequestId;
```

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/selectionActions.test.ts src/features/ai/AiSelectionPopover.test.tsx src/components/wysiwyg/SelectionToolbar.test.tsx`

Expected: PASS.

```bash
git add src/features/ai/selectionActions.ts src/features/ai/selectionActions.test.ts src/features/ai/AiSelectionPopover.tsx src/features/ai/AiSelectionPopover.test.tsx src/components/wysiwyg/SelectionToolbar.tsx src/components/wysiwyg/SelectionToolbar.test.tsx
git commit -m "feat(ai): add selected-text quick actions"
git push
```

### Task 2: Define local-agent frontend contracts and exact targets

**Files:**
- Create: `src/features/ai/localAgents/types.ts`
- Create: `src/features/ai/localAgents/targets.ts`
- Create: `src/features/ai/localAgents/targets.test.ts`
- Modify: `src/features/ai/review.ts`
- Test: `src/features/ai/review.test.ts`

**Interfaces:**
- Produces: `LocalAgentKind`, `LocalAgentTargetKind`, `LocalAgentStatus`, `LocalAgentRunRequest`, `LocalAgentRunResult`, `LocalAgentStreamEvent`, `LocalAgentTargetSnapshot`, capture/apply helpers, and `createLocalAgentReview`.
- Consumes: `AiByteRange`, Tiptap Markdown insertion, CodeMirror transactions, and the existing `AiReview` tab model.

- [ ] **Step 1: Write failing target tests**

Cover these exact cases:

```ts
expect(
  captureSourceLocalAgentTarget({
    source: '가나다 alpha',
    anchor: 1,
    head: 3,
    documentId: 'doc-1',
  }),
).toMatchObject({
  kind: 'selection',
  characterRange: { start: 1, end: 3 },
  byteRange: { start: 3, end: 9 },
  selectedText: '나다',
});

expect(
  captureSourceLocalAgentTarget({
    source: 'alpha',
    anchor: 2,
    head: 2,
    documentId: 'doc-1',
  }),
).toMatchObject({ kind: 'insert', characterRange: { start: 2, end: 2 } });
```

Also assert stale source/document rejection, exact WYSIWYG `{from,to}` insertion, one `insertContentAt(..., {contentType:'markdown'})` call, full-document proposal construction, mismatched request metadata rejection, and no source mutation during capture.

- [ ] **Step 2: Run and verify the missing contracts fail**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/localAgents/targets.test.ts src/features/ai/review.test.ts`

Expected: FAIL because the local-agent modules and Review origin do not exist.

- [ ] **Step 3: Add serialization-compatible shared types**

```ts
export type LocalAgentKind = 'claude' | 'codex' | 'opencode';
export type LocalAgentTargetKind = 'insert' | 'selection' | 'document';

export interface LocalAgentStatus {
  kind: LocalAgentKind;
  mention: '@claude' | '@codex' | '@opencode';
  label: 'Claude Code' | 'Codex' | 'OpenCode';
  installed: boolean;
  compatible: boolean;
  pathLabel: string | null;
  version: string | null;
  reason: string | null;
}

export interface LocalAgentRunRequest {
  requestId: string;
  documentId: string;
  agent: LocalAgentKind;
  target: LocalAgentTargetKind;
  source: string;
  selection: AiByteRange | null;
  cursor: number | null;
  instruction: string;
}

export interface LocalAgentRunResult {
  schemaVersion: 1;
  requestId: string;
  documentId: string;
  agent: LocalAgentKind;
  target: LocalAgentTargetKind;
  markdown: string;
  summary: string;
  warnings: string[];
}

export type LocalAgentStreamEvent =
  | { type: 'starting'; requestId: string }
  | { type: 'running'; requestId: string }
  | { type: 'validating'; requestId: string }
  | { type: 'completed'; requestId: string }
  | { type: 'failed'; requestId: string; code: string; message: string }
  | { type: 'cancelled'; requestId: string };
```

- [ ] **Step 4: Implement one unified snapshot contract**

`LocalAgentTargetSnapshot` stores `documentId`, full `source`, `surface`, `kind`, collapsed-or-expanded character/byte ranges, selected text, and the collapsed-or-expanded ProseMirror range. `captureSourceLocalAgentTarget` and `captureWysiwygLocalAgentTarget` must clamp offsets, reject surrogate-pair splits, and infer `insert` when start equals end. `asDocumentLocalAgentTarget` clears all ranges and changes only `kind`.

```ts
export interface LocalAgentTargetSnapshot {
  documentId: string;
  source: string;
  surface: 'source' | 'wysiwyg';
  kind: LocalAgentTargetKind;
  characterRange: AiByteRange | null;
  byteRange: AiByteRange | null;
  selectedText: string;
  proseMirrorRange: AiByteRange | null;
}

export function asDocumentLocalAgentTarget(
  snapshot: LocalAgentTargetSnapshot,
): LocalAgentTargetSnapshot {
  return {
    ...snapshot,
    kind: 'document',
    characterRange: null,
    byteRange: null,
    selectedText: '',
    proseMirrorRange: null,
  };
}

export function localAgentTargetFromAiSelectionSnapshot(
  snapshot: AiSelectionSnapshot,
): LocalAgentTargetSnapshot;
```

`applySourceLocalAgentResult` dispatches one CodeMirror transaction. `applyWysiwygLocalAgentResult` calls one Tiptap `insertContentAt` transaction. Both require exact source, document, agent target, request ID, and result metadata matches.

- [ ] **Step 5: Add local-agent Review origin without weakening OpenRouter behavior**

```ts
export type AiReviewOrigin =
  | { kind: 'openrouter' }
  | { kind: 'localAgent'; agent: LocalAgentKind; target: LocalAgentTargetKind };
```

Default `createAiReview` and `createPendingAiReview` to `{kind:'openrouter'}`. `createLocalAgentReview(snapshot, request, result, sourceDocumentName)` constructs a validated synthetic `AiRunRequest/AiRunResult` with `task:'custom'`, one exact operation, `usage:null`, and a full `proposedMarkdown`; this lets existing Apply All/Open as document logic remain source-snapshot guarded.

```ts
export function createLocalAgentReview(
  snapshot: LocalAgentTargetSnapshot,
  request: LocalAgentRunRequest,
  result: LocalAgentRunResult,
  sourceDocumentName = 'Untitled',
): AiReview;
```

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/localAgents/targets.test.ts src/features/ai/review.test.ts src/features/ai/selection.test.ts`

Expected: PASS.

```bash
git add src/features/ai/localAgents/types.ts src/features/ai/localAgents/targets.ts src/features/ai/localAgents/targets.test.ts src/features/ai/review.ts src/features/ai/review.test.ts
git commit -m "feat(ai): add guarded local-agent targets"
git push
```

### Task 3: Discover executables and prove adapter capabilities

**Files:**
- Create: `src-tauri/src/local_agents/mod.rs`
- Create: `src-tauri/src/local_agents/discovery.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: inline Rust unit tests in both new modules

**Interfaces:**
- Produces: Rust `LocalAgentKind`, `LocalAgentStatus`, `ResolvedAgent`, `discover_all`, and `resolve_compatible_agent`.
- Consumes: GUI `PATH`, `login_shell_path_value`, fixed executable basenames, and bounded process probes.

- [ ] **Step 1: Write failing executable-resolution tests**

Create temporary executable files named only `claude`, `codex`, and `opencode`; assert PATH ordering, canonical absolute resolution, non-executable/missing rejection, duplicate removal, basename allowlisting, and redacted `bin/claude`-style labels that never contain the temporary root.

```rust
let resolved = resolve_from_paths(LocalAgentKind::Claude, &[first_bin, second_bin])?;
assert_eq!(resolved.path, first_claude.canonicalize()?);
assert_eq!(resolved.path_label, "bin/claude");
assert!(!resolved.path_label.contains(temp.path().to_string_lossy().as_ref()));
```

- [ ] **Step 2: Write failing capability tests with fake probe output**

Assert:

- Claude requires `--safe-mode`, `--print`, `--tools`, `--permission-mode`, `--strict-mcp-config`, `--mcp-config`, `--no-session-persistence`, `--output-format`, and `--json-schema`.
- Codex requires every execution flag and parses `features list`; every denylisted feature must be `false`, and every remaining enabled feature must be in `PASSIVE_CODEX_FEATURES`.
- OpenCode requires `run --pure --format json --dir`, `debug config --pure`, and an effective `permission` map whose wildcard and every named capability are exactly `deny`.
- malformed output, a 5-second timeout, a renamed flag, an unknown enabled Codex feature, or a permission override yields `compatible:false` with a stable reason.

```rust
assert!(!evaluate_codex_features("future_tool stable true\n")?.compatible);
assert!(!opencode_permissions_are_denied(&serde_json::json!({
    "permission": {"*": "deny", "bash": "allow"}
})));
```

- [ ] **Step 3: Run the tests and confirm missing modules fail**

Run: `cargo test -p markdowner-desktop local_agents::discovery::tests -- --nocapture`

Expected: FAIL because `local_agents` is not registered.

- [ ] **Step 4: Implement fixed discovery and status types**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAgentKind { Claude, Codex, Opencode }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentStatus {
    pub kind: LocalAgentKind,
    pub mention: &'static str,
    pub label: &'static str,
    pub installed: bool,
    pub compatible: bool,
    pub path_label: Option<String>,
    pub version: Option<String>,
    pub reason: Option<String>,
}
```

Make `login_shell_path_value` `pub(crate)` and merge its directories after the GUI PATH without invoking a user-supplied shell command. Resolve only the enum's compiled basename and canonicalize before spawning.

- [ ] **Step 5: Implement fail-closed probes**

Use a `ProbeRunner` trait in tests and the production bounded command runner in real status checks. Keep `CODEX_DENIED_FEATURES` and `PASSIVE_CODEX_FEATURES` as these explicit sorted arrays. The Codex feature probe uses all deny flags and `-c mcp_servers={}` but omits `--strict-config` because the installed CLI rejects that flag for `features list`; the actual `exec` invocation retains it.

```rust
trait ProbeRunner {
    fn run(&self, executable: &Path, args: &[OsString], env: &[(OsString, OsString)])
        -> Result<ProbeOutput, LocalAgentError>;
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

const CODEX_DENIED_FEATURES: &[&str] = &[
    "apps", "auth_elicitation", "browser_use", "browser_use_external",
    "browser_use_full_cdp_access", "chronicle", "code_mode", "code_mode_host",
    "computer_use", "enable_mcp_apps", "goals", "guardian_approval", "hooks",
    "image_generation", "in_app_browser", "in_app_updates", "memories",
    "multi_agent", "multi_agent_v2", "plugin_sharing", "plugins",
    "recommended_plugins", "remote_plugin", "shell_snapshot", "shell_tool",
    "skill_mcp_dependency_install", "skill_search", "standalone_web_search",
    "tool_call_mcp_elicitation", "tool_suggest", "unified_exec", "view_image",
    "workspace_dependencies",
];

const PASSIVE_CODEX_FEATURES: &[&str] = &[
    "collaboration_modes", "enable_request_compression", "fast_mode", "item_ids",
    "mentions_v2", "personality", "remote_compaction_v2", "resize_all_images",
    "sqlite", "steer", "terminal_resize_reflow",
    "tool_search_always_defer_mcp_tools", "tui_app_server",
];
```

- [ ] **Step 6: Run Rust tests and commit**

Run: `cargo test -p markdowner-desktop local_agents::discovery::tests -- --nocapture`

Expected: PASS with no real provider calls.

```bash
git add src-tauri/src/local_agents/mod.rs src-tauri/src/local_agents/discovery.rs src-tauri/src/lib.rs
git commit -m "feat(ai): discover safe local agent adapters"
git push
```

### Task 4: Build fixed prompts, invocations, and strict result parsers

**Files:**
- Create: `src-tauri/src/local_agents/adapters.rs`
- Modify: `src-tauri/src/local_agents/mod.rs`
- Test: inline `adapters::tests`

**Interfaces:**
- Produces: `AdapterInvocation`, `build_invocation`, `parse_adapter_result`, `LocalAgentPayload`, and the shared JSON Schema.
- Consumes: `ResolvedAgent`, validated request data, and an owned temporary directory.

- [ ] **Step 1: Write failing argv and environment snapshot tests**

For each agent assert the exact executable, arguments, cwd, environment overrides, stdin bytes, and output-file locations. Include prompts containing quotes, newlines, leading flags, `$()`, backticks, Unicode, and shell metacharacters; assert none become an argument and the entire generated prompt remains stdin data.

```rust
let request = fixture_request("--model evil\n$(touch /tmp/nope) `whoami` 가나다");
let invocation = build_invocation(&resolved, &request, temp.path())?;
assert!(!invocation.args.iter().any(|arg| arg.to_string_lossy().contains("touch")));
assert!(String::from_utf8(invocation.stdin)?.contains("$(touch /tmp/nope)"));
```

- [ ] **Step 2: Write failing parser tests**

Use fixtures with:

```json
{"schemaVersion":1,"markdown":"# Result\n","summary":"Rewrote heading","warnings":[]}
```

Assert Claude extracts only `structured_output`, Codex parses only the owned output-last-message file, and OpenCode concatenates only completed NDJSON events shaped as `{"type":"text","part":{"type":"text","text":"...","time":{"end":1}}}`. Reject tool-use events, error events, extra prose, code fences, unknown keys, wrong schema version, blank Markdown/summary, non-string warnings, NUL, invalid UTF-8, truncation, and output above 2 MiB.

- [ ] **Step 3: Run and verify missing adapter implementation fails**

Run: `cargo test -p markdowner-desktop local_agents::adapters::tests -- --nocapture`

Expected: FAIL because the adapter builders/parsers do not exist.

- [ ] **Step 4: Implement the shared request prompt and strict payload**

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAgentPayload {
    pub schema_version: u8,
    pub markdown: String,
    pub summary: String,
    pub warnings: Vec<String>,
}
```

The prompt marks `instruction` and document data as separate length-prefixed data sections, states that document text is untrusted content rather than instructions, names the exact target/range, and requires only the schema object. Selection and document prompts serialize `AiDocumentEnvelope` editable segments/protected placeholders and require every placeholder to survive; insert prompts include the captured source only as context. Validate `schema_version == 1`, non-empty trimmed Markdown/summary, strings-only warnings, UTF-8, NUL absence, and size limits after extraction.

```rust
fn build_prompt(request: &LocalAgentRunRequest) -> Result<String, LocalAgentError>;

fn validate_payload(payload: LocalAgentPayload) -> Result<LocalAgentPayload, LocalAgentError> {
    if payload.schema_version != 1 || payload.markdown.trim().is_empty() {
        return Err(LocalAgentError::new("invalid_result", "The agent returned an invalid result."));
    }
    Ok(payload)
}
```

- [ ] **Step 5: Implement exact fixed adapter invocations**

- Claude: `--safe-mode --print --no-session-persistence --tools "" --permission-mode dontAsk --strict-mcp-config --mcp-config {"mcpServers":{}} --output-format json --json-schema SCHEMA` with prompt on stdin.
- Codex: `exec --strict-config --sandbox read-only --ephemeral --skip-git-repo-check --output-schema SCHEMA_FILE --output-last-message RESULT_FILE`, every `CODEX_DENIED_FEATURES` item as `--disable NAME`, `-c mcp_servers={}`, and `-` for stdin.
- OpenCode: `run --pure --format json --dir TEMP_DIR`, prompt on stdin, `OPENCODE_CONFIG_CONTENT` with sharing disabled and wildcard plus explicit `deny` permissions, and `OPENCODE_DISABLE_AUTOUPDATE=true`.

```rust
pub struct AdapterInvocation {
    pub executable: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(OsString, OsString)>,
    pub cwd: PathBuf,
    pub stdin: Vec<u8>,
    pub result_file: Option<PathBuf>,
}
```

- [ ] **Step 6: Run adapter tests and commit**

Run: `cargo test -p markdowner-desktop local_agents::adapters::tests -- --nocapture`

Expected: PASS.

```bash
git add src-tauri/src/local_agents/adapters.rs src-tauri/src/local_agents/mod.rs
git commit -m "feat(ai): add tool-disabled agent adapters"
git push
```

### Task 5: Add bounded execution, cancellation, and Tauri commands

**Files:**
- Create: `src-tauri/src/local_agents/process.rs`
- Modify: `src-tauri/src/local_agents/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `crates/markdowner-core/src/ai_document.rs`
- Test: `crates/markdowner-core/tests/markdown_fixtures.rs`
- Test: inline Rust tests in `process.rs` and `mod.rs`

**Interfaces:**
- Produces: `LocalAgentState`, `LocalAgentRunRequest`, `LocalAgentRunResult`, `LocalAgentStreamEvent`, `local_agent_statuses`, `local_agent_run`, and `local_agent_cancel`.
- Consumes: discovery and adapter interfaces from Tasks 3-4.

- [ ] **Step 1: Add failing request-validation and concurrency tests**

Assert exact error codes for empty/oversized IDs, blank or 16-KiB-plus instructions, 2-MiB-plus source, missing selection/cursor, invalid UTF-8 byte boundaries, target/range mismatches, duplicate request IDs, and a second concurrent run in the same window. Assert two different window labels can own one run each. For selection and document results, also assert protected placeholders are restored, missing/unknown protected tokens fail, link destinations and skill tokens remain exact, and broken fence/table structure fails. Assert errors never contain source or prompt fragments.

```rust
assert_eq!(validate_request(&fixture_request_with_instruction(" ")).unwrap_err().code, "invalid_instruction");
assert_eq!(validate_request(&fixture_request_with_source("x".repeat(MAX_SOURCE_BYTES + 1))).unwrap_err().code, "source_too_large");
state.begin("main", "first")?;
assert_eq!(state.begin("main", "second").unwrap_err().code, "local_agent_busy");
assert!(state.begin("secondary", "third").is_ok());
```

- [ ] **Step 2: Add failing fake-process lifecycle tests**

Create executable test scripts that echo valid results, emit oversized stdout/stderr, sleep past a short injected timeout, spawn a child, exit non-zero, or emit partial output. Assert bounded collection, sanitized stderr tail, timeout/cancel process-group termination, exact temporary-directory cleanup, content-free events, and no parsing after cancellation.

```rust
let outcome = run_process(invocation, cancellation, Duration::from_millis(50)).await;
assert_eq!(outcome.unwrap_err().code, "local_agent_timeout");
assert!(!owned_temp_path.exists());
let serialized_events = serde_json::to_string(&events)?;
assert!(!serialized_events.contains("captured source"));
assert!(!serialized_events.contains("private prompt"));
```

- [ ] **Step 3: Enable async process features and run the failing tests**

Change Tokio features to include `process` and `io-util`; add `libc = "0.2"` under Unix dependencies for process-group signaling.

Run: `cargo test -p markdowner-desktop local_agents:: -- --nocapture`

Expected: FAIL until the runner and commands are implemented.

- [ ] **Step 4: Implement the one-run registry and stable errors**

```rust
#[derive(Clone, Default)]
pub struct LocalAgentState {
    active: Arc<Mutex<HashMap<String, ActiveLocalAgentRun>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentError {
    pub code: String,
    pub message: String,
}
```

Use the injected Tauri window label as the map key. Register a `CancellationToken` before spawn and remove it with an RAII guard on every completion path. `local_agent_cancel` matches both the window label and exact request ID, signals cancellation, and returns false for stale IDs.

- [ ] **Step 5: Implement bounded child execution**

Spawn directly with `tokio::process::Command`, piped stdin/stdout/stderr, `kill_on_drop(true)`, and a new Unix process group. Read stdout/stderr concurrently into capped buffers; overflow, cancellation, or timeout kills the process group and waits for exit. Set temp directory/file permissions to user-only and let `TempDir` remove only its owned path after parsing.

```rust
tokio::select! {
    result = child.wait() => finish_child(result?),
    _ = cancellation.cancelled() => terminate_process_group(&mut child, "cancelled").await,
    _ = tokio::time::sleep(timeout) => terminate_process_group(&mut child, "timeout").await,
}
```

For a selection, construct `AiDocumentEnvelope::new` with the exact byte range and pass parsed `markdown` through `validate_selection_response`. For a whole document, add and call:

```rust
pub fn validate_full_replacement(
    envelope: &AiDocumentEnvelope,
    replacement_text: &str,
    summary: String,
    warnings: Vec<String>,
) -> Result<ValidatedDocument, ValidationError>;
```

The helper validates/restores every protected placeholder, checks Markdown structure against the captured source, and returns one full-range replace operation. Return only restored Markdown to the frontend. Insert results add content and therefore use strict schema/NUL/size validation plus Tiptap Markdown parsing rather than asserting that newly inserted markup existed in the old source.

- [ ] **Step 6: Register commands and IPC events**

```rust
#[tauri::command]
pub async fn local_agent_statuses() -> Result<Vec<LocalAgentStatus>, LocalAgentError>;

#[tauri::command]
pub async fn local_agent_run(
    window: WebviewWindow,
    state: State<'_, LocalAgentState>,
    request: LocalAgentRunRequest,
    on_event: Channel<LocalAgentStreamEvent>,
) -> Result<LocalAgentRunResult, LocalAgentError>;

#[tauri::command]
pub fn local_agent_cancel(
    window: WebviewWindow,
    state: State<'_, LocalAgentState>,
    request_id: String,
) -> bool;
```

Manage `LocalAgentState::default()` during Tauri setup and add all three commands to `generate_handler!`.

- [ ] **Step 7: Run Rust tests and commit**

Run: `cargo test -p markdowner-desktop local_agents:: -- --nocapture`

Expected: PASS with fake executables only.

```bash
git add src-tauri/Cargo.toml src-tauri/src/local_agents/process.rs src-tauri/src/local_agents/mod.rs src-tauri/src/lib.rs crates/markdowner-core/src/ai_document.rs crates/markdowner-core/tests/markdown_fixtures.rs
git commit -m "feat(ai): run local agents in bounded processes"
git push
```

### Task 6: Wire desktop services, disclosure persistence, and status settings

**Files:**
- Modify: `src/lib/desktop.ts`
- Test: `src/lib/desktop.test.ts`
- Modify: `src/lib/settings.ts`
- Test: `src/lib/settings.test.ts`
- Modify: `crates/markdowner-core/src/settings.rs`
- Create: `src/features/ai/localAgents/LocalAgentSettings.tsx`
- Create: `src/features/ai/localAgents/LocalAgentSettings.test.tsx`
- Modify: `src/shell/SettingsPanel.tsx`
- Test: `src/shell/SettingsPanel.test.tsx`

**Interfaces:**
- Produces: `localAgentStatuses`, `localAgentRun`, `localAgentCancel`, persisted `localAgentDisclosureAccepted`, and `LocalAgentSettings`.
- Consumes: the Tauri commands from Task 5 and existing App-owned settings persistence.

- [ ] **Step 1: Write failing desktop wrapper tests**

Mock `invoke` and `Channel`; assert exact command names/payloads, event forwarding, and cancellation IDs:

```ts
await localAgentStatuses();
await localAgentRun(request, onEvent);
await localAgentCancel('local-agent-1');

expect(invoke).toHaveBeenNthCalledWith(1, 'local_agent_statuses');
expect(invoke).toHaveBeenNthCalledWith(
  3,
  'local_agent_cancel',
  { requestId: 'local-agent-1' },
);
```

- [ ] **Step 2: Write failing settings migration tests**

Assert `{}` and malformed values normalize `localAgentDisclosureAccepted` to false; true round-trips through TypeScript normalization and Rust camelCase serde without changing OpenRouter consent.

```ts
invokeMock.mockResolvedValue({});
await expect(loadSettings()).resolves.toMatchObject({
  localAgentDisclosureAccepted: false,
});
invokeMock.mockResolvedValue({
    ...DEFAULT_SETTINGS,
    aiCloudDisclosureAccepted: false,
    localAgentDisclosureAccepted: true,
});
await expect(loadSettings()).resolves.toMatchObject({
  aiCloudDisclosureAccepted: false,
  localAgentDisclosureAccepted: true,
});
```

- [ ] **Step 3: Write failing LocalAgentSettings tests**

Assert three ordered rows, installed/version/compatible reason rendering, redacted path labels, Refresh behavior, disclosure toggle routing, the exact warning that the local executable may contact its configured provider and consume quota, and the OpenCode-specific warning that its installation may retain local session metadata.

```ts
expect(screen.getAllByTestId('local-agent-status-row')).toHaveLength(3);
expect(screen.getByText(/may contact its configured provider/i)).toBeInTheDocument();
expect(screen.getByText(/OpenCode may retain local session metadata/i)).toBeInTheDocument();
```

- [ ] **Step 4: Run and verify failures**

Run: `pnpm exec vitest run --maxWorkers=1 src/lib/desktop.test.ts src/lib/settings.test.ts src/features/ai/localAgents/LocalAgentSettings.test.tsx src/shell/SettingsPanel.test.tsx`

Run: `cargo test -p markdowner-core settings -- --nocapture`

Expected: FAIL on missing wrappers, setting, and component.

- [ ] **Step 5: Implement wrappers and persistence**

Use a Tauri `Channel<LocalAgentStreamEvent>` exactly like `aiRun`; add `localAgentDisclosureAccepted: false` to both default settings models and boolean normalization/deserialization.

```ts
export async function localAgentRun(
  request: LocalAgentRunRequest,
  onEvent: (event: LocalAgentStreamEvent) => void,
): Promise<LocalAgentRunResult> {
  const channel = new Channel<LocalAgentStreamEvent>();
  channel.onmessage = onEvent;
  return invoke('local_agent_run', { request, onEvent: channel });
}
```

- [ ] **Step 6: Render read-only local-agent settings**

Mount `LocalAgentSettings` immediately after `OpenRouterSettings`. It accepts only `disclosureAccepted`, `onDisclosureAcceptedChange`, and injectable status services; it never accepts executable paths, flags, credentials, or models.

```tsx
<LocalAgentSettings
  disclosureAccepted={settings.localAgentDisclosureAccepted}
  onDisclosureAcceptedChange={(localAgentDisclosureAccepted) =>
    onSettingsChange({ ...settings, localAgentDisclosureAccepted })
  }
/>
```

- [ ] **Step 7: Run tests and commit**

Run: `pnpm exec vitest run --maxWorkers=1 src/lib/desktop.test.ts src/lib/settings.test.ts src/features/ai/localAgents/LocalAgentSettings.test.tsx src/shell/SettingsPanel.test.tsx`

Run: `cargo test -p markdowner-core settings -- --nocapture`

Expected: PASS.

```bash
git add src/lib/desktop.ts src/lib/desktop.test.ts src/lib/settings.ts src/lib/settings.test.ts crates/markdowner-core/src/settings.rs src/features/ai/localAgents/LocalAgentSettings.tsx src/features/ai/localAgents/LocalAgentSettings.test.tsx src/shell/SettingsPanel.tsx src/shell/SettingsPanel.test.tsx
git commit -m "feat(ai): add local agent settings and services"
git push
```

### Task 7: Build the local-agent composer and mention picker

**Files:**
- Create: `src/features/ai/localAgents/mentions.ts`
- Create: `src/features/ai/localAgents/mentions.test.ts`
- Create: `src/features/ai/localAgents/LocalAgentComposer.tsx`
- Create: `src/features/ai/localAgents/LocalAgentComposer.test.tsx`

**Interfaces:**
- Produces: `LOCAL_AGENT_MENTIONS`, `filterLocalAgentMentions`, `isEligibleLocalAgentMentionKey`, and `LocalAgentComposer`.
- Consumes: statuses/services from Task 6 and snapshots/results from Task 2.

- [ ] **Step 1: Write failing mention-domain tests**

Assert fixed order, case-insensitive `@`, `@c`, and `@o` filtering, no user additions, and eligibility only for `event.key === '@'` at block start or after whitespace. Reject words/emails, inline code, code blocks, frontmatter, multi-cell selection, unsupported nodes, modifiers other than the Shift needed to type `@`, `event.isComposing`, and `event.key === 'Process'`.

```ts
expect(filterLocalAgentMentions('@c').map((item) => item.mention)).toEqual([
  '@claude',
  '@codex',
]);
expect(isEligibleLocalAgentMentionKey(viewAtBlockStart, atKey)).toEqual({
  from: 1,
  to: 1,
});
expect(isEligibleLocalAgentMentionKey(viewInsideEmail, atKey)).toBeNull();
```

- [ ] **Step 2: Write failing composer tests**

Cover:

- initial mention completion with all three statuses;
- Arrow Up/Down, Enter/Tab selection, Escape closing completion;
- disabled incompatible rows with their reason;
- removable/reselectable mention chip;
- preserved prompt and target after agent replacement;
- selection/insert defaults and explicit document target;
- no Run without disclosure, compatible agent, non-empty prompt, or idle state;
- explicit disclosure acceptance callback;
- exact `LocalAgentRunRequest` and no pre-run mutation;
- closing before Run leaves the captured document byte-for-byte unchanged;
- status messages, disabled Close while running, Cancel, sanitized error, and success callback.

```ts
fireEvent.change(screen.getByLabelText('Instruction'), {
  target: { value: 'Turn this into a checklist' },
});
fireEvent.click(screen.getByRole('button', { name: 'Run @codex' }));
expect(run).toHaveBeenCalledWith(
  expect.objectContaining({
    agent: 'codex',
    target: 'selection',
    instruction: 'Turn this into a checklist',
  }),
  expect.any(Function),
);
```

- [ ] **Step 3: Run and verify missing UI fails**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/localAgents/mentions.test.ts src/features/ai/localAgents/LocalAgentComposer.test.tsx`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the fixed mention registry and eligibility helper**

```ts
export const LOCAL_AGENT_MENTIONS = [
  { kind: 'claude', mention: '@claude', label: 'Claude Code' },
  { kind: 'codex', mention: '@codex', label: 'Codex' },
  { kind: 'opencode', mention: '@opencode', label: 'OpenCode' },
] as const;
```

The eligibility helper accepts the ProseMirror view/event and returns the current `{from,to}` only when no character should be inserted and the selection context is safe.

- [ ] **Step 5: Implement accessible composer state**

The component owns mention query/active index, selected agent, prompt, target, statuses, running ID, status, and error. It exposes `onClose`, `onDisclosureAcceptedChange`, and `onResult(result, snapshot, request)`. It fetches statuses on open, starts only inside `handleRun`, forwards lifecycle events, and calls cancellation only for its active request ID.

```ts
export interface LocalAgentComposerProps {
  snapshot: LocalAgentTargetSnapshot;
  disclosureAccepted: boolean;
  preferredAgent?: LocalAgentKind | null;
  onDisclosureAcceptedChange: (accepted: boolean) => void;
  onClose: () => void;
  onResult: (
    result: LocalAgentRunResult,
    snapshot: LocalAgentTargetSnapshot,
    request: LocalAgentRunRequest,
  ) => void;
  services?: LocalAgentComposerServices;
}
```

- [ ] **Step 6: Run tests and commit**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/localAgents/mentions.test.ts src/features/ai/localAgents/LocalAgentComposer.test.tsx`

Expected: PASS.

```bash
git add src/features/ai/localAgents/mentions.ts src/features/ai/localAgents/mentions.test.ts src/features/ai/localAgents/LocalAgentComposer.tsx src/features/ai/localAgents/LocalAgentComposer.test.tsx
git commit -m "feat(ai): add local agent mention composer"
git push
```

### Task 8: Add WYSIWYG `@`, selection, and command-palette entry points

**Files:**
- Modify: `src/shell/commandPaletteCommands.ts`
- Test: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`
- Modify: `src/features/ai/AiSelectionPopover.tsx`

**Interfaces:**
- Produces: one App-owned `openLocalAgentComposer(snapshot, preferredAgent?)` route for every entry point.
- Consumes: quick-action handoff from Task 1, target capture from Task 2, eligibility from Task 7, and the stable Tiptap editorProps closure.

- [ ] **Step 1: Write failing command-palette tests**

Add `runLocalAgent: () => void` and `ai.runLocalAgent` labeled `Run local agent`; enable it for any open document, including a collapsed caret, and disable it when no document is open. Preserve all existing command ordering expectations by inserting it directly after `ai.runSelection`.

```ts
{
  id: 'ai.runLocalAgent',
  category: 'AI',
  label: 'Run local agent',
  disabled: !activeDocumentOpen,
  run: actions.runLocalAgent,
}
```

- [ ] **Step 2: Write failing App entry-point tests**

Assert:

- clicking selection-toolbar `AI actions` still opens the OpenRouter action panel;
- `Use local agent` preserves the captured selection and opens composer mention completion;
- eligible WYSIWYG `@` calls `preventDefault`, returns true from `handleKeyDown`, inserts no `@`, and captures caret/selection;
- email/word/code/frontmatter/table-cell/IME `@` returns false and remains ordinary input;
- Command Palette captures selection or caret in WYSIWYG and Source modes;
- tab or editor-mode change closes the composer and clears its snapshot.

```ts
const handled = tiptapMockState.lastOptions.editorProps.handleKeyDown(
  editor.view,
  new KeyboardEvent('keydown', { key: '@', shiftKey: true }),
);
expect(handled).toBe(true);
expect(editor.commands.insertContent).not.toHaveBeenCalled();
expect(await screen.findByRole('dialog', { name: /local agent/i })).toBeVisible();
```

- [ ] **Step 3: Run and verify failures**

Run: `pnpm exec vitest run --maxWorkers=1 src/shell/commandPaletteCommands.test.ts src/App.test.tsx -t "local agent|AI actions|mention"`

Expected: FAIL on the missing command and App state.

- [ ] **Step 4: Add App state without destabilizing IME**

Add `localAgentSnapshot` and `localAgentComposerOpen` state plus a stable ref invoked inside the memoized `wysiwygEditorProps.handleKeyDown`. Do not add reactive settings or handler dependencies to `wysiwygEditorProps`; update the ref outside the memo so Tiptap does not call `setOptions` during composition.

```ts
const openLocalAgentComposerRef = useRef<
  (selection: { from: number; to: number }) => void
>(() => undefined);

const mentionRange = isEligibleLocalAgentMentionKey(view, event);
if (mentionRange) {
  event.preventDefault();
  openLocalAgentComposerRef.current(mentionRange);
  return true;
}
```

- [ ] **Step 5: Route every entry point through one capture function**

The toolbar path transforms the existing `AiSelectionSnapshot` into a local selection snapshot. The inline `@` and Command Palette paths flush WYSIWYG Markdown before mapping ProseMirror offsets, or use current CodeMirror offsets. Render one `LocalAgentComposer` at App overlay level and pass settings disclosure updates through the existing `handleSettingsChange` persistence path.

```tsx
{localAgentSnapshot && localAgentComposerOpen ? (
  <LocalAgentComposer
    snapshot={localAgentSnapshot}
    disclosureAccepted={settings.localAgentDisclosureAccepted}
    onDisclosureAcceptedChange={(localAgentDisclosureAccepted) =>
      handleSettingsChange({ ...settings, localAgentDisclosureAccepted })
    }
    onClose={closeLocalAgentComposer}
    onResult={handleLocalAgentResult}
  />
) : null}
```

- [ ] **Step 6: Run entry-point tests and commit**

Run: `pnpm exec vitest run --maxWorkers=1 src/shell/commandPaletteCommands.test.ts src/features/ai/AiSelectionPopover.test.tsx src/App.test.tsx -t "local agent|AI actions|mention"`

Expected: PASS.

```bash
git add src/shell/commandPaletteCommands.ts src/shell/commandPaletteCommands.test.ts src/features/ai/AiSelectionPopover.tsx src/App.tsx src/App.test.tsx
git commit -m "feat(ai): open local agents from editor mentions"
git push
```

### Task 9: Apply safe results and integrate local-agent Review

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`
- Modify: `src/features/ai/AiReviewTab.tsx`
- Test: `src/features/ai/AiReviewTab.test.tsx`
- Modify: `src/features/ai/review.ts`
- Test: `src/features/ai/review.test.ts`
- Modify: `src/lib/documentTabs.ts`
- Test: existing document-tab tests covering Review tabs

**Interfaces:**
- Produces: direct exact insert/selection application, document Review, stale-target Review fallback, local selected-operation rendering, and local-agent rerun routing.
- Consumes: guarded target functions and `createLocalAgentReview` from Task 2.

- [ ] **Step 1: Write failing result-application integration tests**

Assert exact WYSIWYG caret insertion, non-ASCII selection replacement, GFM table parsing, source-mode insertion/replacement, draft publication, focus restoration, no implicit disk save, and one Undo restoring the prior Tiptap document. Assert document/source/selection/caret/mode/request/agent/target drift or Tiptap insertion failure refuses direct application, preserves a Review proposal, and never redirects output to the current caret. Assert local runs never call AI History, OpenRouter result storage, or diagnostics/telemetry recording.

```ts
expect(editor.chain().focus().insertContentAt).toHaveBeenCalledWith(
  { from: 7, to: 7 },
  '- [ ] First\n- [ ] Second',
  { contentType: 'markdown' },
);
expect(editor.commands.undo()).toBe(true);
expect(editor.getMarkdown()).toBe(sourceBeforeRun);
```

- [ ] **Step 2: Write failing Review tests**

Assert document results always open Review without source mutation; stale insert/selection results open a full captured-source proposal; local Review displays `Claude Code`, `Codex`, or `OpenCode`, summary, and warnings while omitting OpenRouter model/generation/token/cost fields. Assert Apply All only for current source, stale Apply disabled, Open as new document enabled, local selected-operation rendering stays frontend-local, and Rerun reopens the composer with the same agent/prompt/target.

```ts
expect(screen.getByText('Codex')).toBeInTheDocument();
expect(screen.queryByText(/Prompt .*Completion .*Total/i)).not.toBeInTheDocument();
expect(screen.queryByText(/cost unavailable/i)).not.toBeInTheDocument();
expect(onApply).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run and verify failures**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/AiReviewTab.test.tsx src/features/ai/review.test.ts src/App.test.tsx -t "local agent|Undo|stale target"`

Expected: FAIL until result routing and Review origin UI are complete.

- [ ] **Step 4: Implement App result routing**

For `insert` and `selection`, re-read the active document/source/mode and call the guarded source or WYSIWYG apply helper. On success publish the serialized WYSIWYG draft or update the source draft, close composer state, announce the exact action, and focus the editor. For `document` or any stale/failed direct application, construct `createLocalAgentReview` and activate a Review tab without calling OpenRouter result storage.

```ts
const applied = applyWysiwygLocalAgentResult({
  editor,
  snapshot: captured,
  currentDocumentId,
  currentSource: liveSource,
  request,
  result,
});
if (!applied || captured.kind === 'document') {
  activateLocalAgentReview(createLocalAgentReview(captured, request, result, sourceName));
}
```

- [ ] **Step 5: Make Review origin-aware**

Branch presentation and selected-operation rendering on `review.origin.kind`. Keep existing OpenRouter calls unchanged. For a local review, render the already validated `proposedMarkdown` from selected operation IDs using a pure helper and never call `aiRenderSelectedOperations` or `aiDiscardResult`. Rerun routes local origin back to the composer and OpenRouter origin back to the AI Feature panel.

```ts
const rendered =
  review.origin.kind === 'localAgent'
    ? renderLocalReviewOperations(review, operationIds)
    : await aiRenderSelectedOperations(review.requestId, operationIds);
```

Add this exact pure interface to `review.ts`:

```ts
export function renderLocalReviewOperations(
  review: AiReview,
  operationIds: string[],
): string;
```

- [ ] **Step 6: Run focused and neighboring tests**

Run: `pnpm exec vitest run --maxWorkers=1 src/features/ai/AiReviewTab.test.tsx src/features/ai/review.test.ts src/features/ai/localAgents/targets.test.ts src/lib/documentTabs.test.ts src/App.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the completed user-facing chain**

```bash
git add src/App.tsx src/App.test.tsx src/features/ai/AiReviewTab.tsx src/features/ai/AiReviewTab.test.tsx src/features/ai/review.ts src/features/ai/review.test.ts src/lib/documentTabs.ts src/lib/documentTabs.test.ts
git commit -m "feat(ai): apply guarded local agent proposals"
git push
```

### Task 10: Review, harden, and prove the complete feature

**Files:**
- Modify only files implicated by review findings.
- Test all frontend and Rust workspaces.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: evidence that the approved product, safety, editor, and Git contracts hold together.

- [ ] **Step 1: Review the full feature diff**

Run:

```bash
git diff e2be4d1..HEAD --stat
git diff e2be4d1..HEAD -- src src-tauri crates
git diff --check
```

Check every design section against a concrete test, inspect argv/environment redaction, verify no raw source/prompt logging, and verify no CLI can receive a workspace path or enabled tool.

- [ ] **Step 2: Run formatting and static checks**

Run:

```bash
pnpm exec tsc --noEmit
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all exit 0.

- [ ] **Step 3: Run the complete frontend and Rust suites**

Run:

```bash
pnpm exec vitest run --maxWorkers=1
cargo test --workspace
pnpm test
```

Expected: all tests pass; fake executables are the only local-agent processes used.

- [ ] **Step 4: Run the production build**

Run: `pnpm build`

Expected: TypeScript and Vite/Tauri production build succeeds without a version bump or installation request.

- [ ] **Step 5: Perform a reviewer pass and fix only verified findings**

Review correctness, security boundaries, async cancellation, Tiptap/IME stability, accessibility, test coverage, and maintainability. For each accepted finding, add a failing regression test, implement the minimal correction, rerun its focused tests, then repeat the full checks from Steps 2-4.

- [ ] **Step 6: Commit review fixes when a diff exists**

```bash
git add src src-tauri crates
git commit -m "fix(ai): harden local agent editing"
git push
```

If review produces no diff, do not create an empty commit.

- [ ] **Step 7: Prove final Git parity**

Run:

```bash
git status --short --branch
git rev-list --left-right --count HEAD...@{u}
git rev-parse HEAD
git rev-parse @{u}
git ls-remote origin refs/heads/main
```

Expected: clean worktree, `0 0`, and identical local/tracking/live-remote SHAs.

---

## Execution Notes

- Implement tasks in order because Tasks 6-9 consume the exact IPC and target contracts created in Tasks 2-5.
- Each commit is an ordinary immediate push checkpoint; never rebase, force-push, or stage unrelated user files.
- The design and this plan live under an ignored documentation directory, so stage them only with explicit `git add -f` when updating documentation checkpoints.
- Do not run account-backed smoke tests without separate user consent; they can consume quota and inherit each provider's retention policy.

## References

- Design: `docs/superpowers/specs/2026-08-10-wysiwyg-ai-selection-actions-design.md`
- Existing exact selected-range logic: `src/features/ai/selection.ts`
- Existing Review model: `src/features/ai/review.ts`
- Existing WYSIWYG editor boundary: `src/App.tsx`
- Existing login-shell PATH helper: `src-tauri/src/lib.rs`
- OpenCode completed JSON text events: `packages/opencode/src/cli/cmd/run.ts` in the official `anomalyco/opencode` repository: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts
