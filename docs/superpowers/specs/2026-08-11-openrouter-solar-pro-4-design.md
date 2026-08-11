# OpenRouter Solar Pro 4 Support Design

## Summary

Markdowner will expose Upstage Solar Pro 4 as a curated OpenRouter model for
every existing AI Feature task. The integration will use the current
OpenRouter connection, live catalog, endpoint pricing, structured-output,
privacy, activity, history, cancellation, and review paths without adding a
new provider or changing the default model.

## Goals

- Pin OpenRouter model `upstage/solar-pro4` as `Solar Pro 4`.
- Make it discoverable in the PRD, Summary, Translation, and Custom prompt
  model selectors.
- Describe its 524,288-token context window in the local fallback metadata.
- Keep live OpenRouter catalog data authoritative when it is available.
- Verify the pinned-model policy and settings controls with focused tests.
- Publish the feature with the requested Headatever patch version bump.

## Non-goals

- Do not store an Upstage API key in Markdowner.
- Do not call `api.upstage.ai` directly or add a second AI provider.
- Do not manage OpenRouter BYOK credentials.
- Do not change Markdowner's default AI model.
- Do not add Solar-specific prompts, reasoning controls, or routing behavior.
- Do not make a billable live model request as part of automated verification.

## Approaches Considered

### 1. Curated OpenRouter model — selected

Add Solar Pro 4 to `PINNED_AI_MODEL_CHOICES`. This guarantees discoverability
alongside the existing curated models while preserving live model metadata,
pricing, eligibility checks, and the current request path.

### 2. Live catalog only

Rely on OpenRouter's account catalog without pinning the model. This requires
little code, but discoverability depends on refresh state and account-specific
catalog responses, so it does not provide a stable supported default choice.

### 3. Replace the default model

Make Solar Pro 4 the default for every AI task. This is unnecessary for model
support and would change existing users' behavior, estimates, and provider
selection without a separate product decision.

## Model Contract

The pinned choice will use:

- ID: `upstage/solar-pro4`
- label: `Solar Pro 4`
- fallback context length: `524_288`
- fallback input modality: text
- fallback output modality: text
- fallback structured-output parameters: `response_format` and
  `structured_outputs`

OpenRouter's live model catalog remains authoritative. A live entry replaces
the fallback metadata by model ID before models are ordered. The fallback only
keeps the model visible when the catalog is missing or stale; the existing
endpoint-pricing and availability gates still decide whether Run can proceed.

## User Interface and Data Flow

No new screen or control is required. The existing settings model selectors
will show Solar Pro 4 in the same pinned order for PRD, Summary, Translation,
and Custom prompt defaults. The AI workbench will show the same model through
the shared ordered catalog.

```text
OpenRouter model catalog
  + curated Solar Pro 4 fallback
  -> shared task-aware model ordering
  -> settings and workbench selectors
  -> existing pricing, ZDR, consent, and input gates
  -> existing OpenRouter chat completion request
  -> existing validation, Activity, History, and Review
```

The stored setting remains the OpenRouter model ID string, so existing settings
serialization and model validation need no schema migration.

## Error and Privacy Contract

- A missing live catalog entry does not hide the pinned choice.
- Unknown eligible endpoint pricing continues to block Run.
- An unavailable, non-structured, non-ZDR, or otherwise ineligible endpoint
  continues to use the existing disabled or provider-error state.
- The OpenRouter key stays in macOS Keychain and is never returned to the UI.
- Document content is sent only through the existing OpenRouter disclosure and
  consent path.
- Existing redaction, cancellation, history-retention, and review behavior is
  unchanged.

## Testing and Verification

Use test-driven development:

1. Extend the pinned-model policy expectation first and observe it fail because
   `upstage/solar-pro4` is absent.
2. Assert the fallback label, 524,288-token context, pinned status, and
   structured-output eligibility.
3. Assert all four settings selectors expose Solar Pro 4.
4. Add the model choice and rerun the focused tests to green.
5. Run the full TypeScript tests, type checking, production build, Rust tests,
   formatting checks, and diff checks required by the repository.

Automated tests prove model discovery and reuse of the established OpenRouter
transport contract. They do not prove a billable Solar Pro 4 completion; no
provider credential or paid request is required for this scoped change.

## Release Contract

The feature is one `feat(ai)` checkpoint with its focused tests. After the
feature is green and pushed, Headatever performs the requested patch bump and
creates the annotated version tag. Markdowner's package, Tauri, and Cargo
metadata are then synchronized to the new `VERSION`, verified, committed as a
release checkpoint, and pushed with the tag. Existing unrelated worktree
changes must not enter either checkpoint.
