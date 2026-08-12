# Selection AI, Local Agent Discovery, and Auto Save Design

## Summary

Markdowner will make selected-text AI work when a drag begins or ends inside a
protected Markdown element, add a configurable keyboard shortcut for opening
the selected-text prompt, repair local coding-agent discovery on macOS, and
make the difference between file auto save and recovery backups explicit.

The selected range remains exact. Markdowner does not silently widen it to a
whole link, code span, marker, or block. Any protected bytes that overlap the
selection remain unchanged while editable prose in the same selection may be
improved. The complete proposed document must still pass the existing Markdown
structure and snapshot checks before Markdowner applies one editor transaction.

Local-agent discovery will combine the GUI process PATH, a delimiter-framed
login-shell PATH, and a short list of standard macOS installation directories.
Settings will also accept one executable path for each supported agent. Manual
paths go through the same capability, file-identity, process-isolation, and
tool-denial checks as automatically found executables.

File auto save remains opt-in and defaults to off. When enabled, it writes a
file-backed document one second after editing settles. Independent recovery
backups continue to update after one second in Markdowner's private recovery
storage even when file auto save is off; they never write the original file.

## Goals

- Eliminate `Selection boundaries cannot split a protected Markdown element.`
  for selections that contain both editable prose and a boundary fragment of a
  protected Markdown element.
- Preserve the exact source and ProseMirror ranges captured when the user made
  the selection.
- Keep every overlapping protected byte unchanged in the AI request and result.
- Refuse a paid request when the selected range contains no editable bytes.
- Keep one-transaction application and AI Review fallback behavior.
- Add `Cmd+Shift+K` as the default `Prompt selected text` shortcut.
- Make the shortcut rebindable in Keyboard Shortcuts and visible in the command
  palette, toolbar tooltip, and accessibility metadata.
- Detect Claude Code, Codex, and OpenCode when a noisy login shell prints a
  banner or other text while starting.
- Search standard Homebrew and user-local macOS executable directories even
  when the GUI PATH is minimal.
- Let the user configure, browse for, clear, and recheck an executable path for
  each supported local agent.
- Keep all existing local-agent safety restrictions for automatic and manual
  paths.
- Label file auto save as an original-file write, keep it off by default, and
  explain that recovery backups are independent.
- Preserve user choices already stored as a valid `autoSave` boolean.

## Non-goals

- Do not expand a selected range to encompass an entire protected element.
- Do not let AI change fenced code, inline code, link destinations, HTML tags,
  Markdown markers, skill tokens, or other bytes covered by the protection
  policy.
- Do not redirect a result to a different range if its original snapshot is
  stale.
- Do not add a user-defined agent kind, command template, argument list, model,
  environment variable, or shell command.
- Do not recursively scan the home directory for executables.
- Do not relax agent capability probes, tool denial, bounded I/O, process-group
  cleanup, executable identity checks, or isolated working directories.
- Do not claim that a local executable uses an offline model or avoids its own
  provider charges.
- Do not disable recovery backups when file auto save is off.
- Do not move recovery data to a volatile system temporary directory; it must
  survive an ordinary app restart or crash until the document is saved or
  explicitly discarded.
- Do not reset a valid auto-save choice from an existing settings file.
- Do not bump the application version or publish a release as part of this
  implementation.

## Existing Behavior and Root Causes

### Selected-text AI

The frontend captures an exact document ID, source snapshot, character range,
UTF-8 byte range, selected text, and optional ProseMirror range. Rust then
creates an `AiDocumentEnvelope` for that byte range. Before this change, envelope
creation rejects the request if either boundary lies strictly inside any
protected token. The rejection occurs before a provider request begins and the
raw validation message reaches the user.

The existing result path is otherwise correct: Rust validates the response and
reconstructed document, while the frontend checks the document ID, source
snapshot, exact range, selected text, operation, and proposed document. A valid
result is one undoable editor transaction; stale or uninsertable output opens
AI Review.

### Keyboard access

`AI: Run on Selection...` exists in the command palette but has no dedicated
binding. The WYSIWYG selection toolbar exposes `AI actions`, and Source mode
shows a selection button, but neither advertises a keyboard shortcut.

### Local agents

Discovery currently combines the GUI PATH with stdout from a login shell that
runs `printf %s "$PATH"`. It requires stdout to contain only the PATH. On the
affected Mac, the login-shell startup files print a banner and session details
before the command output. Markdowner rejects the entire value as malformed,
falls back to the restricted GUI PATH, and misses:

- Claude Code at `~/.local/bin/claude`;
- Codex at `~/.local/bin/codex` or `/opt/homebrew/bin/codex`; and
- OpenCode at `/opt/homebrew/bin/opencode`.

Settings can refresh status but cannot supply a path when automatic discovery
fails.

### Save and recovery

`Settings.autoSave` already defaults to `false` in TypeScript and Rust. When it
is true, `App` schedules an original-file save after one second. Separately,
dirty buffers are written after a one-second debounce to the app's recovery
store beside other session data. Recovery entries are removed when they are no
longer dirty or when the user explicitly discards them.

The settings row currently says only `Auto Save`, so it does not explain which
file is written or that recovery continues while the switch is off.

## Selected-Text Processing

### Exact-range rule

The source and ProseMirror ranges captured by the frontend remain the only
application target. Rust must not normalize, widen, or move those ranges.

For each full-document protected token, envelope construction computes its
intersection with the selected byte range:

```text
overlap.start = max(token.start, selection.start)
overlap.end   = min(token.end, selection.end)
```

An empty intersection is ignored. A non-empty intersection becomes a protected
range inside the selection, including when the selection contains only the
left or right fragment of the full protected token. That fragment receives a
normal opaque placeholder in the provider document. The placeholder must be
returned exactly once and in order, just like an entirely selected protected
token.

The selected envelope therefore contains:

- ordinary editable bytes unchanged;
- opaque placeholders for every protected overlap; and
- the original exact selection as its processing scope.

No partial protected content is sent as editable prose.

### Restored-context validation

After the provider returns a replacement, Markdowner restores each protected
overlap and reconstructs the proposed full source. Full-document protection is
then recalculated.

For a full protected token that crosses a selection boundary, validation joins
three pieces conceptually:

1. the unchanged prefix before the selection, if present;
2. the restored protected overlap inside the replacement; and
3. the unchanged suffix after the selection, if present.

The resulting full token must be contiguous, retain the same kind and original
bytes, and appear at the expected shifted range. Extra text inserted between
these pieces, deleted fragments, reordering, or a changed delimiter fails the
same protected-context validation used elsewhere. The complete proposal must
also pass fixed-identifier and Markdown-structure validation.

The final validated operation continues to report the user's exact selection
as `sourceRange`, not the full protected token.

### No editable bytes

If protected overlaps cover the entire selected byte range, Markdowner does not
start OpenRouter or a local agent. It announces:

> The selection contains only protected Markdown and cannot be changed.

This avoids cost and replaces the internal boundary error with an actionable
explanation. A selection containing at least one editable byte proceeds even
if other bytes are protected.

### Application behavior

The frontend keeps the current safeguards:

- document ID must match;
- current source must equal the captured source;
- selected text and UTF-8 byte range must match;
- the result must contain one valid replacement operation for that range;
- the reconstructed proposed document must match Rust's result; and
- Source and WYSIWYG apply through one editor transaction.

If any check fails after a valid result exists, Markdowner opens AI Review. It
never applies the replacement at the current cursor or a newly selected range.

The same clipped-protection behavior applies to OpenRouter selected-text runs
and local-agent `selection` targets because both use `AiDocumentEnvelope`.

## Prompt Selected Text Shortcut

Add `ai.runSelection` to the rebindable shell command registry with the default
binding `mod+shift+k`, displayed as `Cmd+Shift+K` on macOS. The action resolves
to the existing `openAiForCurrentSelection` flow.

The command is available only for an open document with a non-empty ordinary
text selection. If invoked without one, it leaves the document unchanged and
announces `Select text before running an AI prompt`.

The effective binding appears in:

- Settings > Keyboard Shortcuts under an `AI` section;
- the `AI: Run on Selection...` command-palette row;
- the WYSIWYG `AI actions` toolbar button tooltip;
- the Source selection prompt button tooltip; and
- `aria-keyshortcuts` where a persistent control represents the action.

Changing the binding uses the existing conflict detector. System-reserved,
fixed-editor, and already assigned application bindings remain unavailable.
Reset restores `Cmd+Shift+K`.

The application-level key handler must run in both Source and WYSIWYG modes
without replacing editor text or invoking an editor-native `Cmd+Shift+K`
behavior.

## Local Agent Path Resolution

### Resolution order

Resolve each supported agent independently in this order:

1. the configured manual path for that agent, when non-empty;
2. directories from the GUI process PATH;
3. directories extracted from the login-shell PATH;
4. standard system and Homebrew directories; and
5. standard directories below the current user's home directory.

Automatic discovery evaluates executable candidates in that order until one
passes canonicalization, executable proof, version, and capability validation.
A missing or incompatible automatic candidate does not hide a compatible
lower-priority candidate. If executables were found but none is compatible,
status reports the failure from the highest-priority discovered candidate.
Canonical duplicate files and directories are checked only once.

A configured manual path is authoritative. If it is missing, non-executable,
unsafe, or incompatible, the row shows that failure instead of silently using
another executable. `Reset to Auto` clears the path and restores automatic
resolution.

### Login-shell PATH framing

The login-shell command prints the PATH between two fixed, non-printable framed
markers. Discovery searches the bounded stdout byte buffer for the final valid
marker pair and parses only the bytes between them. Text before or after the
pair is ignored.

The parser rejects:

- a missing or reversed marker;
- an empty captured value;
- NUL, newline, or carriage-return bytes inside the captured PATH;
- output or captured values over the existing bounds; and
- non-absolute path entries after splitting.

The shell executable and argument array stay fixed. No settings value or user
path is interpolated into a shell command.

### Standard macOS directories

Automatic discovery adds these fixed system directories when they exist:

```text
/opt/homebrew/bin
/usr/local/bin
/usr/bin
/bin
```

It also adds these directories below an absolute current-user home directory:

```text
~/.local/bin
~/.opencode/bin
~/.bun/bin
~/.cargo/bin
~/.volta/bin
~/.npm-global/bin
~/.local/share/pnpm
~/Library/pnpm
```

Login-shell PATH remains responsible for version-manager-specific locations
such as active nvm, mise, or asdf shims. Markdowner does not traverse version
manager trees or the wider home directory.

### Manual path settings

Persist three independent strings in Settings:

```ts
localAgentExecutablePaths: {
  claude: string;
  codex: string;
  opencode: string;
}
```

Each Local AI Agents row contains:

- a text input with the configured path;
- `Browse...`, using a file picker;
- `Reset to Auto`, disabled when the input is empty;
- the existing compatibility badge, version, and reason; and
- a per-row indication of `Manual path` or `Automatic` resolution.

Changing text updates local component state. Blur or Enter persists the trimmed
value and refreshes that agent. Browse persists the selected absolute path and
refreshes it. Reset stores an empty string and refreshes automatic discovery.
The section-level Refresh button rechecks all three current values.

Paths beginning with `~/` are expanded from the current user's absolute home
directory. Other tilde forms and relative paths are rejected. The persisted
value remains the user's readable input; Rust uses a canonical absolute path
for proof and execution.

Malformed legacy values normalize independently to empty strings. Adding these
fields does not change local-agent consent.

### Status and run consistency

Status probing and actual execution receive the same configured path for the
chosen agent. A compatible status never grants a permanent exemption: each run
resolves the current path again, captures a fresh executable proof, repeats the
required capability checks, and verifies file identity before private input is
released and after the process finishes.

Only the executable path is configurable. Adapter arguments, disabled tools,
temporary configuration, environment filtering, working directory, input and
output bounds, timeout, cancellation, and cleanup remain owned by Markdowner.

## Auto Save and Recovery

Rename the settings row from `Auto Save` to `Auto Save to File` and add this
description:

> When enabled, Markdowner writes file-backed edits after 1 second. Off by
> default. Recovery backups continue without changing the original file.

`Settings.autoSave` remains a boolean with a TypeScript and Rust default of
`false`. TypeScript normalization and the field-specific Rust deserializer both
fall back to `false` for a missing or malformed value without discarding other
valid settings. A valid stored `true` or `false` remains unchanged.

When `autoSave` is false:

- typing updates the editor's in-memory draft;
- the original file is not written by the one-second auto-save effect;
- explicit Save and Save As continue to work; and
- the one-second recovery-backup debounce remains active for dirty tabs.

When `autoSave` is true, only eligible file-backed dirty documents are written
after the existing one-second delay. Untitled documents still require Save As.

Recovery backups remain in Markdowner's private application recovery storage,
not beside the user's document. They contain only dirty tab drafts, survive a
normal restart, restore before editing resumes, and disappear after a matching
save or an explicit discard. Recovery failures may be logged but must not turn
on file auto save or block editing.

The command-palette action keeps the labels `Enable Auto Save to File` and
`Disable Auto Save to File` so the mutation is unambiguous.

## Errors and User Feedback

- A selection with no editable bytes gets the protected-selection announcement
  before any provider call.
- A stale selected-text result follows the existing AI Review path.
- An invalid manual path reports a specific local-only reason: missing file,
  relative path, unsupported tilde form, non-executable file, failed safety
  proof, incompatible version, or capability-probe timeout.
- Status messages must not include probe stdout/stderr, credentials, document
  content, or environment values.
- A noisy or malformed login-shell probe falls back to GUI and standard paths;
  it does not make the entire status request fail.
- Saving settings and probing status are separate. A probe failure does not
  erase the configured path.
- A recovery-backup failure does not write the original file as a fallback.

## Security and Privacy

- Protected Markdown fragments stay opaque in provider requests.
- Manual executable paths do not add shell interpolation or arbitrary flags.
- Executable files and interpreter chains keep their current ownership,
  permissions, canonical-path, content-hash, and path-swap checks.
- Local-agent runs remain isolated, non-interactive, bounded, cancellable, and
  tool-disabled.
- The local executable may still contact its configured provider and consume
  quota; the existing disclosure remains required.
- Exact manual paths are visible only in local Settings. Status events and
  diagnostics continue using redacted path labels.
- Recovery drafts remain local and are not added to OpenRouter or local-agent
  history.

## Testing

### Rust selection tests

- A prose selection starting inside an inline-code token preserves the clipped
  code fragment and improves following prose.
- A prose selection ending inside a link destination preserves the clipped
  destination fragment and improves preceding prose.
- A selection beginning and ending inside one protected token contains no
  editable bytes and is rejected before a provider run.
- Multibyte UTF-8 boundaries remain valid and use byte offsets.
- Added text between an outside token fragment and its restored overlap is
  rejected.
- Deleted, changed, duplicated, or reordered protected overlaps are rejected.
- The validated operation retains the exact original selection range.
- Existing full-token, Markdown-structure, identifier, table, HTML, and fence
  fixtures remain green.

### Shortcut tests

- `Cmd+Shift+K` resolves to selected-text AI and prevents the editor-native
  action in Source and WYSIWYG modes.
- Empty selections announce the existing guidance without opening the prompt.
- A valid selection opens the prompt and preserves the captured snapshot.
- A user override replaces the default, conflicts are rejected, and Reset
  restores the default.
- Keyboard Shortcuts, command palette, tooltips, and accessibility metadata
  show the effective binding.

### Local-agent tests

- Login-shell stdout with a banner before and after the framed PATH parses the
  intended value.
- Missing, malformed, oversized, and timed-out framed output safely falls back.
- GUI, login, system, Homebrew, and user-local directories follow the specified
  order and canonical deduplication.
- The affected Mac's `~/.local/bin` and `/opt/homebrew/bin` layout resolves all
  three installed agents.
- Manual paths take precedence, expand `~/`, persist independently, and return
  specific errors without falling back.
- Reset restores automatic resolution.
- Status and run use the same manual path, and a path or content swap before
  execution is rejected.
- UI refresh generations prevent stale probes from replacing newer results.
- Existing capability and process-isolation tests remain green.

### Save and recovery tests

- New and missing settings default file auto save to false in TypeScript and
  Rust.
- Malformed `autoSave` values normalize to false without changing other fields.
- A stored boolean choice round-trips unchanged.
- File auto save off never calls the original-file save after editing.
- File auto save on schedules the existing one-second eligible save.
- Recovery backups schedule after one second in both states.
- Explicit Save, Save As, restore, save cleanup, and discard cleanup remain
  green.
- Settings and command-palette copy distinguishes file writes from recovery.

### Final verification

Run focused tests during each red-green cycle, then run:

```bash
pnpm exec vitest run --maxWorkers=1
pnpm exec tsc --noEmit
pnpm build
cargo fmt --all -- --check
cargo test --workspace --all-targets --all-features
git diff --check
```

Build and install the app without starting a paid AI request. Verify the
Settings controls, effective shortcut, and compatibility status for the actual
Claude Code, Codex, and OpenCode installations. Installed-app verification may
exercise discovery and prompt opening, but it must not press Run.

## Delivery Checkpoints

1. `docs: design selection AI and agent discovery controls`
2. `fix(ai): support protected selection boundaries`
3. `feat(shortcuts): bind selected-text AI prompt`
4. `feat(ai): configure local agent executable paths`
5. `fix(ai): discover agents from noisy login shells`
6. `feat(editor): clarify file auto save and recovery`
7. A corrective commit only if the final verification matrix finds a defect.

Every checkpoint includes its directly related tests, uses explicit staging,
pushes immediately without force, and verifies local/upstream parity before the
next checkpoint starts. The pre-existing `README.md` whitespace change remains
unstaged and unmodified.
