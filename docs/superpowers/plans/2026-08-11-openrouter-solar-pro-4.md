# OpenRouter Solar Pro 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Upstage Solar Pro 4 as a curated OpenRouter model in every Markdowner AI Feature selector, then publish the requested Headatever patch version.

**Architecture:** Add `upstage/solar-pro4` to the existing pinned OpenRouter model registry and let the shared ordering, live-catalog replacement, pricing, ZDR, consent, execution, validation, Activity, History, and Review paths consume it unchanged. Protect the registry metadata and all four settings selectors with focused TypeScript tests; do not add an Upstage credential or direct provider transport.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Rust/Tauri 2, pnpm, Cargo, Headatever, GitHub Actions

## Global Constraints

- Keep `z-ai/glm-5.2` as `DEFAULT_AI_MODEL`.
- Use OpenRouter model ID `upstage/solar-pro4`, label `Solar Pro 4`, and fallback context length `524_288`.
- Do not store an Upstage API key, call `api.upstage.ai`, or manage OpenRouter BYOK credentials.
- Do not add Solar-specific prompts, reasoning controls, routing, dependencies, or settings schema fields.
- Keep OpenRouter's live catalog and eligible endpoint pricing authoritative.
- Preserve the four pre-existing version metadata edits until the release task supersedes them.
- Stage explicit paths only and push every green checkpoint without force.

---

## File Structure

- Modify `src/features/ai/model.ts`: add the curated Solar Pro 4 identity and fallback context metadata.
- Modify `src/features/ai/model.test.ts`: protect the pinned order and fallback eligibility metadata.
- Modify `src/features/ai/OpenRouterSettings.test.tsx`: prove Solar Pro 4 is present in all four existing default-model selectors.
- Modify `VERSION`: Headatever-owned source version in its generated release commit.
- Modify `package.json`: synchronize the new version after Headatever.
- Modify `src-tauri/tauri.conf.json`: synchronize the Tauri application version.
- Modify `src-tauri/Cargo.toml`: synchronize the desktop crate version.
- Modify `Cargo.lock`: synchronize the `markdowner-desktop` package version.

### Task 1: Add Solar Pro 4 to the curated OpenRouter catalog

**Files:**
- Modify: `src/features/ai/model.test.ts:34-71`
- Modify: `src/features/ai/OpenRouterSettings.test.tsx:27-59`
- Modify: `src/features/ai/model.ts:12-34`

**Interfaces:**
- Consumes: `PINNED_AI_MODEL_CHOICES`, `PINNED_AI_MODELS`, and `orderModels(models, task)` from `src/features/ai/model.ts`.
- Produces: pinned ID `upstage/solar-pro4` with label `Solar Pro 4`, context length `524_288`, and the existing fallback structured-output metadata.

- [ ] **Step 1: Write the failing model-policy test**

Add `upstage/solar-pro4` immediately after the unchanged default in the exact pinned list, and add a consumer-visible fallback assertion:

```ts
expect(PINNED_AI_MODELS).toEqual([
  'z-ai/glm-5.2',
  'upstage/solar-pro4',
  'moonshotai/kimi-k3',
  'deepseek/deepseek-v4-flash-0731',
  'google/gemini-3.6-flash',
  'minimax/minimax-m3',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-oss-120b',
  'x-ai/grok-4.5',
]);

expect(options.find((entry) => entry.id === 'upstage/solar-pro4')).toMatchObject({
  name: 'Solar Pro 4',
  contextLength: 524_288,
  supportedParameters: ['response_format', 'structured_outputs'],
  pinned: true,
  enabled: true,
});
```

The first expectation catches removal or misordering. The second catches a
wrong label, context window, structured-output contract, or built-in-task
eligibility.

- [ ] **Step 2: Write the failing settings-selector test**

Replace the Summary-only option assertion with an exact expectation shared by
all four selectors:

```ts
const expectedModels = [
  'z-ai/glm-5.2',
  'upstage/solar-pro4',
  'moonshotai/kimi-k3',
  'deepseek/deepseek-v4-flash-0731',
  'google/gemini-3.6-flash',
  'minimax/minimax-m3',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-oss-120b',
  'x-ai/grok-4.5',
];

for (const label of [
  'PRD default model',
  'Summary default model',
  'Translation default model',
  'Custom prompt default model',
]) {
  const values = Array.from(
    (screen.getByLabelText(label) as HTMLSelectElement).options,
    (option) => option.value,
  );
  expect(values).toEqual(expectedModels);
}
```

This test exercises the real rendered selects instead of only checking the
registry source.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm exec vitest run --maxWorkers=1 \
  src/features/ai/model.test.ts \
  src/features/ai/OpenRouterSettings.test.tsx
```

Expected: FAIL because `upstage/solar-pro4` is absent from the actual pinned
model array and every rendered model selector.

- [ ] **Step 4: Add the minimal model choice**

Insert this entry immediately after the default choice in
`PINNED_AI_MODEL_CHOICES`:

```ts
{
  id: 'upstage/solar-pro4',
  label: 'Solar Pro 4',
  contextLength: 524_288,
},
```

Do not modify `fallbackPinnedModel`, `orderModels`, settings serialization, or
the OpenRouter request client; their existing generic behavior is the intended
integration.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 3 command again.

Expected: both test files pass with zero failures. The fallback model is pinned
and enabled for Translation, and every settings selector contains the same
ordered model IDs.

- [ ] **Step 6: Run the feature checkpoint verification**

Run each command and require a zero exit status:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
git diff --check
```

Review `git diff -- src/features/ai/model.ts src/features/ai/model.test.ts src/features/ai/OpenRouterSettings.test.tsx` and confirm it contains no provider, key, BYOK, default-model, or unrelated changes.

- [ ] **Step 7: Commit and immediately push the green feature**

Stage only the implementation outcome:

```bash
git add src/features/ai/model.ts \
  src/features/ai/model.test.ts \
  src/features/ai/OpenRouterSettings.test.tsx
git diff --cached --check
git commit -m "feat(ai): add OpenRouter Solar Pro 4"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`. Preserve the pushed commit hash before proceeding.

### Task 2: Publish the Headatever patch version

**Files:**
- Modify: `VERSION`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `Cargo.lock`

**Interfaces:**
- Consumes: current source version `0.260807.1`, Headatever `patch`, and `scripts/sync-version.mjs`.
- Produces: source version `0.260811.0`, annotated tag `v0.260811.0`, synchronized package/Tauri/Cargo metadata, and a GitHub Release workflow run.

- [ ] **Step 1: Prove the current version baseline**

Run:

```bash
pnpm sync-version --check
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh show
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --dry-run
git tag -l v0.260811.0
```

Expected: all five version surfaces are `0.260807.1`, the dry run reports
`0.260807.1 -> 0.260811.0`, and the target tag does not exist.

- [ ] **Step 2: Create and push the Headatever release commit and tag**

Run:

```bash
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --push
```

Expected: Headatever writes only `VERSION`, creates commit
`chore(release): v0.260811.0`, creates annotated tag `v0.260811.0`, and pushes
the commit and tag without bypassing signing or hooks.

- [ ] **Step 3: Synchronize app metadata to the new source version**

Run:

```bash
pnpm sync-version
pnpm sync-version --check
git diff -- VERSION package.json src-tauri/tauri.conf.json \
  src-tauri/Cargo.toml Cargo.lock
git diff --check
```

Expected: `VERSION` has no unstaged diff because Headatever committed it. The
other four files contain only `0.260807.1 -> 0.260811.0`, superseding the
preserved pre-existing version synchronization edits.

- [ ] **Step 4: Verify the synchronized release metadata**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
pnpm sync-version --check
```

Expected: every command exits zero against the exact metadata that will be
committed.

- [ ] **Step 5: Commit and push synchronized metadata**

Stage only the four metadata paths:

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
git diff --cached --check
git commit -m "chore(release): sync app versions for v0.260811.0"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0` and a clean worktree.

- [ ] **Step 6: Audit remote tag, workflow, and release state**

Run:

```bash
git ls-remote --tags origin refs/tags/v0.260811.0 \
  'refs/tags/v0.260811.0^{}'
gh run list --workflow Release --commit "$(git rev-list -n 1 v0.260811.0)" \
  --limit 1 --json databaseId,status,conclusion,url,headSha
release_run_id=$(gh run list --workflow Release \
  --commit "$(git rev-list -n 1 v0.260811.0)" --limit 1 \
  --json databaseId --jq '.[0].databaseId')
gh run watch "$release_run_id" --exit-status
gh release view v0.260811.0 --json tagName,url,publishedAt,assets
git status --short --branch
git rev-list --left-right --count HEAD...@{u}
```

Expected: `release_run_id` resolves to the numeric workflow database ID, the
annotated tag and peeled commit are present remotely, the Release workflow
concludes successfully, the GitHub release has at least one DMG asset, the
worktree is clean, and parity is `0 0`.

## Completion Audit

- `upstage/solar-pro4` is pinned with label `Solar Pro 4` and context
  `524_288` while GLM 5.2 remains the default.
- PRD, Summary, Translation, and Custom prompt settings all expose the model.
- No Upstage key, direct transport, BYOK management, dependency, or settings
  field was added.
- Focused tests proved RED before implementation and GREEN afterward.
- Full TypeScript, build, Rust, formatting, version, and diff gates pass.
- Feature, Headatever release, and metadata checkpoints are pushed with their
  exact hashes, the tag is remote, the workflow/release succeeds, and final Git
  parity is `0 0`.
