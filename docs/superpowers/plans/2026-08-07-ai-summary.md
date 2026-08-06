# AI Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class, language-selectable Summary AI task that validates standalone Markdown and opens it only as a new untitled document.

**Architecture:** Extend the shared TypeScript/Rust `AiTask` contract with `summary`, but give Summary a dedicated OpenRouter schema and core validator that produces a `ValidatedDocument` with no edit operations. Reuse the existing model, pricing, privacy, activity, history, and Review infrastructure; specialize Workbench scope/language controls and Review actions so a valid result can only enter a fresh untitled buffer.

**Tech Stack:** React 19, TypeScript 5.8, Vitest and Testing Library, Tauri 2, Rust, Serde, SQLite/rusqlite, Reqwest/OpenRouter structured output.

## Global Constraints

- Summary operates on the current whole document; selection and workspace summaries are out of scope.
- Summary never mutates, prepends to, or replaces the source document.
- `Summary language` defaults to `Same as source`; explicit languages summarize directly without a second translation request.
- `aiSummaryModel` and `aiSummaryTargetLanguage` persist independently from Translation settings.
- Summary uses exactly 4,096 maximum output tokens; Improve PRD remains at 16,384.
- Provider output remains strict JSON and fails closed on malformed, empty, truncated, or language-mismatched results.
- ZDR, cloud consent, cost gates, cancellation warnings, and History retention keep their existing behavior.
- No new dependency, version bump, release, tag, pull request, selection summary, workspace summary, or automatic file save is part of this work.
- Each implementation checkpoint passes focused tests and `git diff --check`, uses explicit staging, commits with a Conventional Commit subject, pushes immediately, and proves upstream parity `0 0`.

---

## File Map

### Backend contract

- `crates/markdowner-core/src/ai_document.rs`: define `SummaryResponse`, Summary validation issues, language normalization, and mapping to an operation-free `ValidatedDocument`.
- `src-tauri/src/ai/openrouter.rs`: add `AiTask::Summary`, a Summary prompt version, Summary prompt text, and the strict response schema.
- `src-tauri/src/ai/mod.rs`: validate Summary requests, pass requested language into result validation, store the correct prompt version, and parse Summary responses.
- `src-tauri/src/ai/history.rs`: persist and restore the `summary` task name.

### Settings and shared frontend model

- `crates/markdowner-core/src/settings.rs`: persist and recover `aiSummaryModel` and `aiSummaryTargetLanguage` at the native settings boundary.
- `src/lib/settings.ts` and `src/lib/settings.test.ts`: add defaults and field-by-field normalization for Summary preferences.
- `src/features/ai/types.ts`, `model.ts`, and `model.test.ts`: extend `AiTask`, expose the `source` sentinel, and retain the 4,096-token structured-output path.
- `src/features/ai/telemetry.ts` and `telemetry.test.ts`: allow the content-free `summary` task identifier.
- `src/features/ai/AiActivityTab.tsx`, `AiActivityTab.test.tsx`, and `AiHistoryTab.test.tsx`: label Summary consistently.

### Settings and request UI

- `src/features/ai/OpenRouterSettings.tsx` and `OpenRouterSettings.test.tsx`: add Summary model and language defaults.
- `src/shell/SettingsPanel.tsx`: wire Summary settings into the existing OpenRouter section.
- `src/features/ai/AiWorkbenchPanel.tsx` and `AiWorkbenchPanel.test.tsx`: add task selection, current-document-only scope, model persistence, language selection, request payload, and cost estimate.

### Review and app integration

- `src/features/ai/review.ts` and `review.test.ts`: make Summary review actions open-only.
- `src/features/ai/AiReviewTab.tsx` and `AiReviewTab.test.tsx`: render Summary preview/languages and a single Summary result action.
- `src/App.test.tsx`: prove opening a validated Summary creates a fresh untitled document without replacing the source.

---

### Task 1: Add the validated Rust Summary contract

**Files:**
- Modify: `crates/markdowner-core/src/ai_document.rs`
- Modify: `src-tauri/src/ai/openrouter.rs`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `src-tauri/src/ai/history.rs`

**Interfaces:**
- Consumes: `AiDocumentEnvelope`, `ValidatedDocument`, `AiCompletionRequest`, `AiRunRequest`, and the existing streaming/history pipeline.
- Produces: `AiTask::Summary`; `SUMMARY_PROMPT_VERSION`; `prompt_version_for_task(AiTask) -> &'static str`; `SummaryResponse`; and `validate_summary_response(&AiDocumentEnvelope, SummaryResponse, Option<&str>) -> Result<ValidatedDocument, ValidationError>`.

- [ ] **Step 1: Write failing core validation tests**

Add tests beside the existing `ai_document` validation tests. The success case asserts that Summary output is standalone and operation-free. Failure cases cover empty Markdown, NUL, bad version, empty language, explicit-language mismatch, and `Same as source` mismatch.

```rust
#[test]
fn summary_validation_builds_a_standalone_operation_free_document() {
    let envelope = AiDocumentEnvelope::new("doc-1", "# Plan\n\nShip Friday.", None).unwrap();
    let validated = validate_summary_response(
        &envelope,
        SummaryResponse {
            schema_version: AI_SCHEMA_VERSION,
            detected_source_language: "en".to_string(),
            summary_language: "ko".to_string(),
            summary_markdown: "# 요약\n\n금요일에 출시합니다.".to_string(),
            warnings: vec!["Date copied from source.".to_string()],
        },
        Some("ko-KR"),
    )
    .unwrap();

    assert_eq!(validated.proposed_markdown, "# 요약\n\n금요일에 출시합니다.");
    assert!(validated.operations.is_empty());
    assert!(validated.hunks.is_empty());
    assert_eq!(validated.detected_source_language.as_deref(), Some("en"));
    assert_eq!(validated.target_language.as_deref(), Some("ko"));
}

#[test]
fn summary_validation_rejects_language_mismatch() {
    let envelope = AiDocumentEnvelope::new("doc-1", "English source", None).unwrap();
    let error = validate_summary_response(
        &envelope,
        SummaryResponse {
            schema_version: AI_SCHEMA_VERSION,
            detected_source_language: "en".to_string(),
            summary_language: "ja".to_string(),
            summary_markdown: "# Summary".to_string(),
            warnings: Vec::new(),
        },
        Some("ko"),
    )
    .unwrap_err();

    assert_eq!(error.issues[0].code, ValidationIssueCode::LanguageMismatch);
}
```

- [ ] **Step 2: Write failing provider and persistence tests**

Add OpenRouter tests for task identity, prompt boundary, task-specific prompt version, target-language tag, and exact strict schema. Add History coverage that round-trips `AiTask::Summary` through SQLite.

```rust
#[test]
fn summary_request_uses_its_strict_schema_and_language() {
    let mut request = fixture_request(AiTask::Summary);
    request.target_language = Some("ko".to_string());
    request.instruction = Some("Focus on decisions.".to_string());
    let body = build_chat_request(&request);

    assert_eq!(body["metadata"]["prompt_version"], SUMMARY_PROMPT_VERSION);
    assert_eq!(body["response_format"]["json_schema"]["name"], "markdown_summary");
    assert_eq!(
        body["response_format"]["json_schema"]["schema"]["required"],
        json!(["schema_version", "detected_source_language", "summary_language", "summary_markdown", "warnings"]),
    );
    assert!(body["messages"][1]["content"].as_str().unwrap().contains("<target_language>ko</target_language>"));
    assert!(body["messages"][1]["content"].as_str().unwrap().contains("<document_data>"));
}
```

- [ ] **Step 3: Run focused Rust tests and confirm red state**

Run:

```bash
cargo test -p markdowner-core summary_validation -- --nocapture
cargo test -p markdowner-desktop summary -- --nocapture
```

Expected: compilation fails because `SummaryResponse`, `AiTask::Summary`, and the validator/schema mappings do not exist.

- [ ] **Step 4: Implement `SummaryResponse` and local validation**

Add serde aliases matching the provider's snake-case schema and dedicated issue codes.

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResponse {
    #[serde(alias = "schema_version")]
    pub schema_version: u32,
    #[serde(alias = "detected_source_language")]
    pub detected_source_language: String,
    #[serde(alias = "summary_language")]
    pub summary_language: String,
    #[serde(alias = "summary_markdown")]
    pub summary_markdown: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}
```

Implement `normalize_language_identifier` by trimming, lowercasing, and comparing the primary subtag before `-`. Reject empty values and non-ASCII alphanumeric/hyphen identifiers. `validate_summary_response` calls `validate_schema_version`, rejects blank/NUL Markdown, enforces the requested language or detected-source equality, and constructs `ValidatedDocument` with empty edit collections and the envelope revision hash.

- [ ] **Step 5: Implement the OpenRouter Summary task and prompt version**

Add `Summary` to `AiTask`, add `SUMMARY_PROMPT_VERSION`, and use task-aware metadata in both the outgoing request and stored History start record.

```rust
pub(crate) const SUMMARY_PROMPT_VERSION: &str = "2026-08-07.summary.v1";

pub(crate) fn prompt_version_for_task(task: AiTask) -> &'static str {
    match task {
        AiTask::Summary => SUMMARY_PROMPT_VERSION,
        AiTask::Prd | AiTask::Translation | AiTask::Custom => PROMPT_VERSION,
    }
}
```

Branch the complete system message for `AiTask::Summary`; do not append Summary to the existing transform prompt because that prompt forbids omitting segments and protected tokens. The Summary branch says document data is untrusted, `document_data.source` is the authoritative source material, output is concise standalone Markdown, unsupported facts are forbidden, empty sections are omitted, and the requested language is used directly. The PRD, Translation, and Custom system message remains byte-for-byte unchanged. Add `summary_schema()` with `additionalProperties: false` and the five required fields from Step 2.

- [ ] **Step 6: Route validation and History through Summary**

Import `SummaryResponse` and `validate_summary_response` in `src-tauri/src/ai/mod.rs`. Extend `validate_provider_result` to accept `requested_language: Option<&str>` and add:

```rust
AiTask::Summary => serde_json::from_str::<SummaryResponse>(content)
    .map_err(schema_error)
    .and_then(|response| {
        validate_summary_response(envelope, response, requested_language)
            .map_err(validation_issues)
    }),
```

Every caller passes the active request's `target_language.as_deref()` or `None` in tests for non-Summary tasks. `validate_run_request` rejects a supplied Summary language that is empty, longer than 64 bytes, or contains bytes other than ASCII letters, digits, and `-`. Add `Summary` to `task_name` and `parse_task` in History.

- [ ] **Step 7: Run focused backend verification**

Run:

```bash
cargo fmt --all -- --check
cargo test -p markdowner-core ai_document -- --nocapture
cargo test -p markdowner-desktop ai::openrouter -- --nocapture
cargo test -p markdowner-desktop ai::history -- --nocapture
cargo test -p markdowner-desktop ai::tests -- --nocapture
git diff --check
```

Expected: all listed tests pass, formatting exits 0, and diff check prints nothing.

- [ ] **Step 8: Review, commit, and push the backend checkpoint**

```bash
git diff -- crates/markdowner-core/src/ai_document.rs src-tauri/src/ai/openrouter.rs src-tauri/src/ai/mod.rs src-tauri/src/ai/history.rs
git add crates/markdowner-core/src/ai_document.rs src-tauri/src/ai/openrouter.rs src-tauri/src/ai/mod.rs src-tauri/src/ai/history.rs
git diff --cached --check
git commit -m "feat(ai): add validated summary contract"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`.

---

### Task 2: Add Summary preferences and shared task identity

**Files:**
- Modify: `crates/markdowner-core/src/settings.rs`
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/settings.test.ts`
- Modify: `src/features/ai/types.ts`
- Modify: `src/features/ai/model.ts`
- Modify: `src/features/ai/model.test.ts`
- Modify: `src/features/ai/telemetry.ts`
- Modify: `src/features/ai/telemetry.test.ts`
- Modify: `src/features/ai/AiActivityTab.tsx`
- Modify: `src/features/ai/AiActivityTab.test.tsx`
- Modify: `src/features/ai/AiHistoryTab.test.tsx`

**Interfaces:**
- Consumes: native/frontend `Settings`, `AiTask`, `outputTokenLimitForTask`, `orderModels`, `sanitizeAiTelemetry`, and `taskLabel`.
- Produces: `AiTask = 'prd' | 'summary' | 'translation' | 'custom'`; `SUMMARY_SOURCE_LANGUAGE = 'source'`; `Settings.aiSummaryModel`; and `Settings.aiSummaryTargetLanguage`.

- [ ] **Step 1: Write failing native and frontend settings tests**

Extend both settings suites with valid, missing, and malformed Summary values.

```ts
expect(DEFAULT_SETTINGS).toMatchObject({
  aiSummaryModel: 'z-ai/glm-5.2',
  aiSummaryTargetLanguage: 'source',
});

invokeMock.mockReset();
invokeMock.mockResolvedValue({
  aiSummaryModel: 42,
  aiSummaryTargetLanguage: false,
  aiTranslationTargetLanguage: 'ja',
});
const normalized = await loadSettings();
expect(normalized.aiSummaryModel).toBe('z-ai/glm-5.2');
expect(normalized.aiSummaryTargetLanguage).toBe('source');
expect(normalized.aiTranslationTargetLanguage).toBe('ja');
```

Use the existing `invokeMock` and `loadSettings` boundary rather than adding a new production API. In Rust, extend `ai_settings_default_and_recover_malformed_fields_independently` to assert camel-case serialized fields `aiSummaryModel` and `aiSummaryTargetLanguage`.

- [ ] **Step 2: Write failing task-model, telemetry, Activity, and History tests**

```ts
expect(outputTokenLimitForTask('summary')).toBe(4_096);
expect(orderModels([model({ id: 'structured/text' })], 'summary')[0].enabled).toBe(true);
expect(
  orderModels(
    [model({ id: 'plain/text', supportedParameters: [] })],
    'summary',
  )[0].disabledReason,
).toMatch(/Structured output/);
expect(sanitizeAiTelemetry({ task: 'summary', source: 'private' })).toEqual({ task: 'summary' });
expect(taskLabel('summary')).toBe('Summarize document');
```

Render Summary fixtures in `AiActivityTab.test.tsx` and `AiHistoryTab.test.tsx`. Assert the accessible heading is `Summarize document` and cancellation passes the Summary request ID.

- [ ] **Step 3: Run focused tests and confirm red state**

Run:

```bash
cargo test -p markdowner-core settings::tests::ai_settings -- --nocapture
pnpm vitest run src/lib/settings.test.ts src/features/ai/model.test.ts src/features/ai/telemetry.test.ts src/features/ai/AiActivityTab.test.tsx src/features/ai/AiHistoryTab.test.tsx --maxWorkers=1
```

Expected: suites fail because Summary fields, task identity, and labels are absent.

- [ ] **Step 4: Implement settings defaults and normalization**

Add native fields with the existing model deserializer and a Summary-language deserializer whose fallback is `source`.

```rust
#[serde(deserialize_with = "deserialize_ai_model")]
pub ai_summary_model: String,
#[serde(deserialize_with = "deserialize_summary_target_language")]
pub ai_summary_target_language: String,
```

The native and frontend normalizers accept `source` or a trimmed language identifier matching `^[A-Za-z0-9-]{1,64}$`; invalid values restore `source`. Add both fields to defaults without changing the Translation target fallback.

- [ ] **Step 5: Implement the shared task identity**

Update the TypeScript union and all content-free allowlists/labels.

```ts
export type AiTask = 'prd' | 'summary' | 'translation' | 'custom';
export const SUMMARY_SOURCE_LANGUAGE = 'source';

export function taskLabel(task: AiTask): string {
  if (task === 'prd') return 'Improve PRD';
  if (task === 'summary') return 'Summarize document';
  if (task === 'translation') return 'Translate document';
  return 'Custom prompt';
}
```

Add `summary` to telemetry's `TASKS`. Keep `outputTokenLimitForTask` behavior unchanged except for tests proving only `prd` returns 16,384. Because `task !== 'custom'` already requires structured output, Summary stays on that branch.

- [ ] **Step 6: Run focused shared-model verification**

Run:

```bash
cargo fmt --all -- --check
cargo test -p markdowner-core settings::tests::ai_settings -- --nocapture
pnpm vitest run src/lib/settings.test.ts src/features/ai/model.test.ts src/features/ai/telemetry.test.ts src/features/ai/AiActivityTab.test.tsx src/features/ai/AiHistoryTab.test.tsx --maxWorkers=1
git diff --check
```

Expected: all tests pass and diff check prints nothing.

- [ ] **Step 7: Review, commit, and push the shared-model checkpoint**

```bash
git diff -- crates/markdowner-core/src/settings.rs src/lib/settings.ts src/lib/settings.test.ts src/features/ai/types.ts src/features/ai/model.ts src/features/ai/model.test.ts src/features/ai/telemetry.ts src/features/ai/telemetry.test.ts src/features/ai/AiActivityTab.tsx src/features/ai/AiActivityTab.test.tsx src/features/ai/AiHistoryTab.test.tsx
git add crates/markdowner-core/src/settings.rs src/lib/settings.ts src/lib/settings.test.ts src/features/ai/types.ts src/features/ai/model.ts src/features/ai/model.test.ts src/features/ai/telemetry.ts src/features/ai/telemetry.test.ts src/features/ai/AiActivityTab.tsx src/features/ai/AiActivityTab.test.tsx src/features/ai/AiHistoryTab.test.tsx
git diff --cached --check
git commit -m "feat(ai): add summary preferences and identity"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`.

---

### Task 3: Add Summary request and language controls

**Files:**
- Modify: `src/features/ai/OpenRouterSettings.tsx`
- Modify: `src/features/ai/OpenRouterSettings.test.tsx`
- Modify: `src/shell/SettingsPanel.tsx`
- Modify: `src/features/ai/AiWorkbenchPanel.tsx`
- Modify: `src/features/ai/AiWorkbenchPanel.test.tsx`

**Interfaces:**
- Consumes: `SUMMARY_SOURCE_LANGUAGE`, `searchLanguages`, `Settings.aiSummaryModel`, `Settings.aiSummaryTargetLanguage`, `AiRunRequest`, and existing Workbench services.
- Produces: a `Summarize document` option; persisted Summary model/language; and `AiRunRequest` values with `task: 'summary'`, current-document scope, `selection: null`, nullable target language, and `maxOutputTokens: 4_096`.

- [ ] **Step 1: Write failing Settings UI tests**

Render `OpenRouterSettings` with Summary props and change both controls.

```tsx
expect(screen.getByLabelText('Summary default model')).toHaveValue('z-ai/glm-5.2');
expect(screen.getByLabelText('Summary language')).toHaveValue('source');
fireEvent.change(screen.getByLabelText('Summary default model'), {
  target: { value: 'moonshotai/kimi-k3' },
});
fireEvent.change(screen.getByLabelText('Summary language'), {
  target: { value: 'ko' },
});
expect(onSummaryModelChange).toHaveBeenCalledWith('moonshotai/kimi-k3');
expect(onSummaryTargetLanguageChange).toHaveBeenCalledWith('ko');
```

The Settings language control offers `Same as source` plus `ko`, `en`, `ja`, and `zh`. It must not call or update the Translation target callback.

- [ ] **Step 2: Write failing Workbench request tests**

Add one test for the default `source` sentinel and one for an explicit Korean summary.

```tsx
fireEvent.change(screen.getByRole('combobox', { name: 'AI task' }), {
  target: { value: 'summary' },
});
expect(screen.getByText(/Current document/)).toBeVisible();
expect(screen.queryByRole('option', { name: /Workspace/ })).not.toBeInTheDocument();
expect(screen.getByLabelText('Summary language')).toHaveValue('source');
fireEvent.click(screen.getByRole('button', { name: /Korean · ko/i }));
fireEvent.click(screen.getByRole('button', { name: 'Run' }));
await waitFor(() =>
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      task: 'summary',
      documentId: 'doc-1',
      selection: null,
      targetLanguage: 'ko',
      maxOutputTokens: 4_096,
      scope: expect.objectContaining({ kind: 'document' }),
    }),
    expect.any(Function),
  ),
);
```

The `Same as source` test asserts `targetLanguage: null`. Both tests assert source and `recordHistory` are forwarded unchanged.

- [ ] **Step 3: Run focused component tests and confirm red state**

Run:

```bash
pnpm vitest run src/features/ai/OpenRouterSettings.test.tsx src/features/ai/AiWorkbenchPanel.test.tsx --maxWorkers=1
```

Expected: Summary controls and task option cannot be found.

- [ ] **Step 4: Wire Summary defaults through Settings**

Extend `OpenRouterSettingsProps` with `summaryModel`, `summaryTargetLanguage`, `onSummaryModelChange`, and `onSummaryTargetLanguageChange`. Add `Summary default model` through `ModelDefaultSelect`. Use a native select for `Summary language` with `source`, `ko`, `en`, `ja`, and `zh`; the Workbench retains searchable access to the full catalog. Wire the four props in `SettingsPanel.tsx` through immutable `onSettingsChange` updates.

- [ ] **Step 5: Implement Workbench task, current-document scope, and model selection**

Add `<option value="summary">Summarize document</option>`. Replace nested task ternaries with focused helpers so Summary cannot fall through to Custom:

```ts
function defaultModelForTask(settings: Settings, task: AiTask): string {
  if (task === 'prd') return settings.aiPrdModel;
  if (task === 'summary') return settings.aiSummaryModel;
  if (task === 'translation') return settings.aiTranslationModel;
  return settings.aiCustomPromptModel;
}
```

On transition to Summary, set `runScope` to `{ kind: 'document', target: currentDocument }`. Render a read-only `Scope` row containing `Current document · ${currentDocument.label}` instead of `AiScopePicker`; this prevents workspace and alternate-open-document selection. Keep the existing picker for every other task.

- [ ] **Step 6: Implement Summary language selection and payload**

Keep Translation's `targetLanguage` state separate from new `summaryLanguage` state. Render the Summary control when `task === 'summary'`, include a `Same as source` value, and reuse `searchLanguages(languageQuery)` for other choices. Persist a choice only through `aiSummaryTargetLanguage`.

```ts
const requestedTargetLanguage =
  task === 'translation'
    ? targetLanguage
    : task === 'summary' && summaryLanguage !== SUMMARY_SOURCE_LANGUAGE
      ? summaryLanguage
      : null;
```

Build Summary requests with `selection: null` even if the editor currently has a selection. Do not apply Translation's same-language blocker to Summary; `Same as source` is valid. Use `outputTokenLimitForTask(task)` so estimate and payload both show 4,096.

- [ ] **Step 7: Run focused request-UI verification**

Run:

```bash
pnpm vitest run src/features/ai/OpenRouterSettings.test.tsx src/features/ai/AiWorkbenchPanel.test.tsx src/features/ai/AiScopePicker.test.tsx --maxWorkers=1
git diff --check
```

Expected: all tests pass; existing PRD, Translation, Custom, and scope tests remain green.

- [ ] **Step 8: Review, commit, and push the request-UI checkpoint**

```bash
git diff -- src/features/ai/OpenRouterSettings.tsx src/features/ai/OpenRouterSettings.test.tsx src/shell/SettingsPanel.tsx src/features/ai/AiWorkbenchPanel.tsx src/features/ai/AiWorkbenchPanel.test.tsx
git add src/features/ai/OpenRouterSettings.tsx src/features/ai/OpenRouterSettings.test.tsx src/shell/SettingsPanel.tsx src/features/ai/AiWorkbenchPanel.tsx src/features/ai/AiWorkbenchPanel.test.tsx
git diff --cached --check
git commit -m "feat(ai): add summary request controls"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`.

---

### Task 4: Make Summary Review open-only and prove source preservation

**Files:**
- Modify: `src/features/ai/review.ts`
- Modify: `src/features/ai/review.test.ts`
- Modify: `src/features/ai/AiReviewTab.tsx`
- Modify: `src/features/ai/AiReviewTab.test.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `AiReview.request.task`, an operation-free `AiValidatedDocument`, `onOpenAsDocument(markdown)`, and App's existing `handleOpenAiProposalAsDocument` path.
- Produces: Summary-specific Review labels and preview; `resolveReviewActions({ task, sourcePresent, sourceRevisionMatches, validationPassed })`; and a source-preserving open-as-Untitled integration contract.

- [ ] **Step 1: Write failing review-model and component tests**

Add task to every `resolveReviewActions` fixture and prove Summary is open-only.

```ts
expect(
  resolveReviewActions({
    task: 'summary',
    sourcePresent: true,
    sourceRevisionMatches: true,
    validationPassed: true,
  }),
).toEqual({
  applySelected: false,
  applyAll: false,
  openAsDocument: true,
  rerun: true,
});
```

Create a Summary `AiRunResult` with empty operations/hunks, detected `en`, target `ko`, and `proposedMarkdown: '# 요약\n\n핵심 내용'`. Assert `Summary proposal`, `Summary preview`, and `Detected en · Summary ko`; assert no `Apply all`, `Apply selected`, change checkbox, or `Proposed changes`; click `Open summary as new document` and assert the callback receives exact Markdown.

- [ ] **Step 2: Write the failing App integration test**

Use the existing mocked native AI completion path, click the Summary Review action, and assert native calls create a fresh document before replacing only that new active buffer.

```tsx
expect(await screen.findByRole('heading', { name: 'Summary proposal' })).toBeVisible();
fireEvent.click(screen.getByRole('button', { name: 'Open summary as new document' }));
await waitFor(() => expect(newDocumentMock).toHaveBeenCalledTimes(1));
expect(replaceActiveDocumentSourceMock).toHaveBeenCalledWith('# 요약\n\n핵심 내용');
expect(newDocumentMock.mock.invocationCallOrder[0]).toBeLessThan(
  replaceActiveDocumentSourceMock.mock.invocationCallOrder[0],
);
expect(screen.getByRole('tab', { name: /Untitled/ })).toHaveAttribute('aria-selected', 'true');
fireEvent.click(screen.getByRole('tab', { name: /requirements\.md/ }));
expect(await screen.findByRole('textbox', { name: /source editor/i })).toHaveValue(
  '# Source\n\nOriginal facts.',
);
```

The fixture returns a validated result with `task: 'summary'`, no operations, no hunks, no validation issues, and a request whose source snapshot is the original source. Bootstrap both the source and newly created document snapshots in `Editor` mode so the content assertions exercise the real editing surface.

- [ ] **Step 3: Run focused Review/App tests and confirm red state**

Run:

```bash
pnpm vitest run src/features/ai/review.test.ts src/features/ai/AiReviewTab.test.tsx src/App.test.tsx --maxWorkers=1
```

Expected: Review exposes apply controls and lacks Summary labels.

- [ ] **Step 4: Make Review actions task-aware**

Add `task: AiTask` to `resolveReviewActions` input and calculate apply permission only for non-Summary tasks:

```ts
const canApply =
  input.task !== 'summary' &&
  input.validationPassed &&
  input.sourcePresent &&
  input.sourceRevisionMatches;
```

`openAsDocument` remains tied only to `validationPassed`. Update every caller and test to pass the request task explicitly.

- [ ] **Step 5: Render Summary-specific Review content and footer**

Add an explicit Summary heading branch before Custom/PRD. Render exact Markdown without operation UI:

```tsx
{review.request.task === 'summary' && document ? (
  <section aria-labelledby="ai-summary-preview-heading">
    <h2 id="ai-summary-preview-heading" className="text-sm font-semibold">
      Summary preview
    </h2>
    <pre className="mt-2 max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md border border-border p-4 font-sans text-sm leading-relaxed">
      {document.proposedMarkdown}
    </pre>
  </section>
) : null}
```

Render source/summary language metadata for Summary. Wrap findings and proposed-changes sections in `task !== 'summary'`. In the footer, render one primary `Open summary as new document` button for Summary; retain existing result actions for other tasks. A stale or closed source notice for Summary describes the captured snapshot and never says Apply was disabled.

- [ ] **Step 6: Preserve the App new-document path**

Use existing `handleOpenAiProposalAsDocument`; do not add a Summary branch that writes to the source. Keep its existing `AI result opened as a new untitled document` announcement, error handling, busy state, stale operation tokens, and editor focus behavior unchanged.

- [ ] **Step 7: Run focused end-to-end frontend verification**

Run:

```bash
pnpm vitest run src/features/ai/review.test.ts src/features/ai/AiReviewTab.test.tsx src/features/ai/AiWorkbenchPanel.test.tsx src/App.test.tsx --maxWorkers=1
git diff --check
```

Expected: all Summary and existing Review/App tests pass.

- [ ] **Step 8: Review, commit, and push the Review checkpoint**

```bash
git diff -- src/features/ai/review.ts src/features/ai/review.test.ts src/features/ai/AiReviewTab.tsx src/features/ai/AiReviewTab.test.tsx src/App.test.tsx
git add src/features/ai/review.ts src/features/ai/review.test.ts src/features/ai/AiReviewTab.tsx src/features/ai/AiReviewTab.test.tsx src/App.test.tsx
git diff --cached --check
git commit -m "feat(ai): open summaries as new documents"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`.

---

## Completion Audit

- [ ] Re-read `docs/superpowers/specs/2026-08-07-ai-summary-design.md` and map every acceptance criterion to a passing focused test or inspected UI/runtime path.
- [ ] Search every exhaustive task mapping and setting surface:

```bash
rg -n "AiTask::|AiTask|taskLabel|task_name|parse_task|aiPrdModel|aiTranslationModel|aiCustomPromptModel|aiSummaryModel|aiSummaryTargetLanguage" crates src src-tauri
```

Confirm each relevant mapping includes Summary and no fallback treats Summary as Custom.

- [ ] Run formatting and the complete Rust workspace test suite:

```bash
cargo fmt --all -- --check
cargo test --workspace
```

- [ ] Run the complete frontend and repository-required test suite:

```bash
pnpm test
```

This command finishes with Vitest failures `0`, `scripts/build-and-install.test.sh` exit `0`, and `src-tauri/scripts/self-update.test.sh` exit `0`. JSDOM `Not implemented` diagnostics are not failures when the final process exits `0`.

- [ ] Run the production build and diff checks:

```bash
pnpm build
git diff --check
git status --short --branch
```

Expected: build exit `0`, no diff-check output, and no uncommitted task files. If a verification fix is required, add a focused regression test, commit it as a new Conventional Commit, push it, and repeat the full audit.

- [ ] Prove published checkpoint history and three-way remote parity:

```bash
git log --oneline 7290da9..HEAD
git status --short --branch
git rev-list --left-right --count HEAD...@{u}
git rev-parse HEAD
git rev-parse '@{u}'
git ls-remote origin refs/heads/main
```

Expected: worktree clean, parity `0 0`, and local, upstream, and live-remote SHAs identical.
