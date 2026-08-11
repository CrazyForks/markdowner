# Solar Pro 4 Default and Selection AI Prompt Design

## Summary

Markdowner will make OpenRouter model `upstage/solar-pro4` the default model for
every AI Feature task and the first model in every shared model selector. The
change will also migrate every persisted task model that still equals the old
default, `z-ai/glm-5.2`, to Solar Pro 4 exactly once. A migration version will
prevent later intentional GLM selections from being rewritten.

The WYSIWYG selection toolbar will also make its AI action reliable. Clicking
AI actions after a drag selection will open the existing selection prompt with
the textarea focused, even if WebKit collapses the live editor selection during
toolbar interaction. Enter will run a custom instruction, Shift+Enter will add
a newline, and composing Enter from an IME will not submit.

Solar Pro 4 will continue to use the existing OpenRouter transport, Keychain
credential, live catalog, endpoint-pricing, ZDR, consent, validation, Activity,
History, cancellation, and Review paths. No Upstage-specific provider or API
key will be added.

## Goals

- Set `upstage/solar-pro4` as the canonical default model in the frontend model
  policy, frontend settings, and Rust settings defaults.
- Put Solar Pro 4 first in the curated pinned model order used by Settings and
  the AI workbench.
- Default PRD, Summary, Translation, and Custom prompt tasks to Solar Pro 4.
- Replace every persisted task-model value equal to `z-ai/glm-5.2` with Solar
  Pro 4 during a one-time migration.
- Preserve persisted non-GLM models during migration.
- Preserve any GLM choice made after the migration has completed.
- Preserve the exact WYSIWYG range captured before an AI toolbar interaction.
- Open the existing selection AI prompt with immediate keyboard focus.
- Run a typed custom instruction with Enter while preserving Shift+Enter for
  multiline input and IME composition for Korean and other languages.
- Report selection-capture failure instead of silently doing nothing.
- Publish a new Headatever patch version and install the final synchronized
  build locally.

## Non-goals

- Do not remove GLM 5.2 from the curated model list.
- Do not add an Upstage API key, direct Upstage transport, or OpenRouter BYOK
  management.
- Do not change prompts, output budgets, model eligibility, pricing, privacy,
  history, or review behavior.
- Do not remove or replace the existing quick-action buttons or model selector
  in the selection AI prompt.
- Do not introduce a second inline prompt inside the selection toolbar.
- Do not make a billable provider request during automated verification.

## Selection AI Prompt Repair

### Failure diagnosis

The toolbar currently reads `editor.state.selection` again inside the AI
button's click handler and returns silently when that range is collapsed. In a
real WebKit/Tiptap interaction, focus and selection can change between the
original drag selection, toolbar mouse down, blur, and click. The unit test only
supplies a permanently selected mock editor, so it does not reproduce that
event sequence.

A second silent return is possible when the application cannot convert the
ProseMirror range into a valid Markdown selection snapshot. Both failures look
identical to the user: the AI actions button appears to do nothing.

### Chosen interaction model

The toolbar will retain the latest valid non-empty editor range while the
selection UI is active. AI activation will use that stable range instead of
depending on the possibly collapsed live selection at click time. Normal click
and keyboard activation will share the same path; pointer down will not be the
sole trigger, so keyboard accessibility and button semantics remain intact.

The stable range will be handed to the existing application-level capture
path, which converts it to the exact Markdown and UTF-8 selection snapshot
before opening `AiSelectionPopover`. The existing popover is the single prompt
surface. It keeps Improve, Rewrite, Shorten, Expand, Make table, Custom
instruction, and the model selector.

When the popover opens, its textarea receives focus. Typing selects the custom
instruction behavior. Enter submits the custom instruction, Shift+Enter
inserts a newline, and Enter is ignored as a submit trigger while
`isComposing` is true or the event carries legacy IME key code `229`.

If the stored editor range can no longer be captured, the application will
announce the failure through its existing user-visible status path rather than
silently returning. Once a snapshot exists, all existing exact-range safety
rules continue to apply: one undoable editor transaction on success, and Review
for stale, invalid, or uninsertable output rather than insertion into a
different range.

### Alternatives considered

- Running solely on pointer down would preserve the live selection earlier,
  but would weaken keyboard support and risk duplicate pointer/click handling.
- Embedding a new input directly in the floating selection toolbar would
  duplicate prompt state and introduce extra layout and collision behavior.
- Reusing the existing popover with a stable captured range is the smallest
  change that fixes the failure while preserving established AI behavior.

## Approved Migration Policy

The selected policy is to migrate every old-default field, not only settings
where all four fields still match GLM.

The four migrated fields are:

- `aiPrdModel`
- `aiSummaryModel`
- `aiTranslationModel`
- `aiCustomPromptModel`

When the stored migration version predates this change, each field is handled
independently:

```text
z-ai/glm-5.2          -> upstage/solar-pro4
any other valid model -> unchanged
missing/invalid model -> current default, upstage/solar-pro4
```

After normalization, Markdowner records the current AI-default migration
version and persists the normalized settings. On later launches, the version
prevents the migration from running again. A user can therefore select GLM 5.2
after upgrading and keep that selection.

## Architecture

### Canonical model policy

The shared frontend registry will define `upstage/solar-pro4` as
`DEFAULT_AI_MODEL`. Its pinned entry will be first, followed by an explicit GLM
5.2 entry and the remaining curated models. The existing `orderModels` function
will continue to place pinned entries before live unpinned models, so both the
Settings selectors and AI workbench inherit the same order.

The TypeScript settings module and Rust settings module will use the same Solar
Pro 4 default. Keeping all three default constants aligned covers initial UI
state, malformed frontend settings, missing or malformed Rust settings, and
backend default serialization.

### Versioned settings migration

The settings contract will gain an internal numeric
`aiModelDefaultsVersion` field in both TypeScript and Rust. The first migration
version is `1`. Rust deserialization will treat the field as version zero when
it is absent from a legacy settings file, while newly constructed settings use
version `1`.

Frontend normalization will compare the loaded version with the current
version. For an older version it will replace each exact legacy GLM model ID,
normalize invalid model values to Solar Pro 4, and set the current version.
`loadSettings` will then make a best-effort call to the existing
`save_settings` command so the migration is durable.

Migration persistence failure will not discard otherwise valid loaded
settings. Markdowner will log the failure, use the migrated Solar values for
the current session, and retry on the next launch because the stored version
remains old.

### Stable WYSIWYG selection entry

`SelectionToolbar` will maintain the latest valid non-empty range associated
with the visible selection controls. Activating AI actions will pass that range
to `WysiwygEditorChrome` and the application rather than re-reading a transient
collapsed selection. The application remains responsible for flushing the
current draft, mapping the ProseMirror positions to Markdown offsets, capturing
the document and selection identity, and opening the prompt.

`AiSelectionPopover` will focus its textarea when opened and handle custom
prompt keyboard submission. It will continue to delegate execution to the
existing OpenRouter selection action and exact-range application pipeline; no
provider-specific execution path is added.

## Data Flow

```text
Rust loads settings.json
  -> missing migration version becomes legacy version 0
  -> frontend normalizes settings
  -> each legacy GLM task field becomes Solar Pro 4
  -> migration version advances
  -> best-effort save_settings persists the result
  -> task default selects Solar Pro 4

OpenRouter live model catalog
  + curated pinned fallback models
  -> Solar Pro 4 first, GLM 5.2 still available
  -> Settings and AI workbench selectors
  -> existing OpenRouter execution and review pipeline

WYSIWYG drag selection
  -> toolbar retains latest valid non-empty ProseMirror range
  -> AI click or keyboard activation uses retained range
  -> application captures exact Markdown and UTF-8 selection snapshot
  -> existing prompt opens with textarea focused
  -> Enter runs custom prompt; Shift+Enter adds newline; IME Enter composes
  -> existing LLM pipeline applies one exact-range editor transaction
  -> stale, invalid, or uninsertable output goes to Review
```

## Error and Privacy Contract

- A missing live Solar Pro 4 catalog entry continues to use the curated
  fallback metadata for discoverability.
- Existing endpoint availability, structured-output, pricing, and ZDR gates
  remain authoritative before a run starts.
- Migration only examines model ID strings; it does not read document content,
  credentials, history, or activity data.
- The OpenRouter key remains in macOS Keychain and is never returned to the UI.
- A migration save error is reported through the existing console error path
  without reverting the in-memory Solar defaults.
- A selection that cannot be converted into a valid snapshot produces a
  user-visible status message instead of a silent no-op.
- Prompt text and selected document content enter the existing provider flow
  only after explicit submission; merely opening the prompt makes no request.
- A saved selection snapshot is never redirected to a newer or different
  editor range. Stale or invalid output is retained for Review.

## Testing and Verification

Use test-driven development for the behavioral checkpoints.

Selection AI prompt repair:

1. Use a real Tiptap editor in a regression test to reproduce drag selection,
   toolbar mouse down or blur, and click, then assert that the prompt opens from
   the retained exact range.
2. Assert both pointer/click and keyboard button activation.
3. Assert that the prompt textarea is focused on open.
4. Assert that Enter runs a typed custom instruction.
5. Assert that Shift+Enter inserts a newline without running.
6. Assert that composing Enter and legacy key code `229` do not run.
7. Assert that selection-capture failure is announced to the user.
8. Preserve existing exact-range insertion, single-transaction undo, stale
   snapshot, and Review fallback tests.

Solar Pro 4 default and migration:

1. Assert that all frontend and Rust canonical defaults are
   `upstage/solar-pro4`.
2. Assert that the pinned model order begins with Solar Pro 4, then GLM 5.2,
   and that every Settings selector renders the same order.
3. Assert that legacy settings migrate every GLM field independently while
   preserving other valid model IDs.
4. Assert that the migrated settings version is persisted once.
5. Assert that a current-version GLM selection is preserved.
6. Assert that migration-save failure still returns migrated in-memory
   settings.
7. Run focused Vitest and Rust settings tests.

After both checkpoints, run the full frontend tests, TypeScript check,
production build, Rust all-target/all-feature tests, Rust formatting check,
version check, and Git diff check.

Automated tests prove the prompt event contract, exact-range safety, default,
ordering, and migration behavior without a paid OpenRouter call. The final
packaged app will additionally be installed to `/Applications/Markdowner.app`;
its version, code signature, executable architecture, and
built-versus-installed executable hash will be verified. The installed app
will receive a local non-billable interaction check confirming that drag
selection followed by AI actions opens the focused prompt; no prompt will be
submitted during that check.

## Release and Checkpoint Contract

The realtime Git workflow will publish these independently green checkpoints:

1. This integrated design document.
2. The reliable selection AI prompt entry and coupled regression tests.
3. The Solar Pro 4 default, ordering, versioned migration, and coupled tests.
4. The Headatever-generated patch release commit and annotated tag.
5. Synchronized package, Tauri, Cargo, and lockfile versions.

Every commit will stage explicit paths, use a Conventional Commit subject, pass
the checks appropriate to its outcome, push without force, and prove upstream
parity `0 0` before the next checkpoint. The final audit will verify the remote
tag, clean worktree, synchronized version surfaces, locally installed app, and
local/tracking/live-remote parity.
