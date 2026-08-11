# Solar Pro 4 Default Model Design

## Summary

Markdowner will make OpenRouter model `upstage/solar-pro4` the default model for
every AI Feature task and the first model in every shared model selector. The
change will also migrate every persisted task model that still equals the old
default, `z-ai/glm-5.2`, to Solar Pro 4 exactly once. A migration version will
prevent later intentional GLM selections from being rewritten.

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
- Publish a new Headatever patch version and install the final synchronized
  build locally.

## Non-goals

- Do not remove GLM 5.2 from the curated model list.
- Do not add an Upstage API key, direct Upstage transport, or OpenRouter BYOK
  management.
- Do not change prompts, output budgets, model eligibility, pricing, privacy,
  history, or review behavior.
- Do not make a billable provider request during automated verification.

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

## Testing and Verification

Use test-driven development for the behavioral checkpoint:

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
7. Run focused Vitest and Rust settings tests, then the full frontend tests,
   TypeScript check, production build, Rust all-target/all-feature tests, Rust
   formatting check, version check, and Git diff check.

Automated tests prove the default, ordering, and migration contracts without a
paid OpenRouter call. The final packaged app will additionally be installed to
`/Applications/Markdowner.app`; its version, code signature, executable
architecture, and built-versus-installed executable hash will be verified.

## Release and Checkpoint Contract

The realtime Git workflow will publish these independently green checkpoints:

1. This approved design document.
2. The Solar Pro 4 default, ordering, versioned migration, and coupled tests.
3. The Headatever-generated patch release commit and annotated tag.
4. Synchronized package, Tauri, Cargo, and lockfile versions.

Every commit will stage explicit paths, use a Conventional Commit subject, pass
the checks appropriate to its outcome, push without force, and prove upstream
parity `0 0` before the next checkpoint. The final audit will verify the remote
tag, clean worktree, synchronized version surfaces, locally installed app, and
local/tracking/live-remote parity.
