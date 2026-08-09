# WYSIWYG AI Selection and Local Agent Actions Design

## Summary

Markdowner will turn its existing selected-text AI prompt into a first-class
editing surface and add content-only integrations for locally installed Claude
Code, Codex, and OpenCode CLIs.

In WYSIWYG mode, dragging over text and choosing `AI actions` will expose quick
OpenRouter actions (`Improve`, `Rewrite`, `Shorten`, `Expand`, and `Make table`)
plus a local-agent composer. Typing `@` at a safe WYSIWYG text boundary will
also open agent completion for `@claude`, `@codex`, and `@opencode` without
inserting the trigger into the document. After choosing an agent, the user
enters a prompt and explicitly runs it.

Local agents never receive direct authority to edit the open file or workspace.
Markdowner launches each CLI in a tool-disabled, isolated, non-interactive
mode; sends a bounded document snapshot and user instruction; validates the
structured Markdown response; and owns the only document mutation. Cursor
results insert at the captured position, selection results replace only the
captured range, and whole-document results always open in Review before an
explicit apply.

## Goals

- Make common selected-text transformations discoverable after a WYSIWYG drag.
- Provide `Improve`, `Rewrite`, `Shorten`, `Expand`, and `Make table` actions
  without requiring the user to formulate routine prompts.
- Detect installed Claude Code, Codex, and OpenCode executables and expose them
  through `@` mention completion.
- Let a local agent insert Markdown at a caret, replace a selected range, or
  propose a whole-document edit.
- Keep local-agent credentials, provider selection, and billing inside each
  installed CLI; Markdowner stores no agent credentials.
- Block local-agent shell, file, plugin, MCP, app, web, and subagent tools for
  embedded runs, and refuse an adapter when the required restrictions cannot
  be proven for the installed version.
- Require an explicit Run action before any provider-backed CLI invocation.
- Validate every returned payload and revalidate its target snapshot before
  applying it.
- Make insertion and selected-range replacement recoverable with one editor
  Undo operation.
- Preserve Markdown structure, protected tokens, source identity, cancellation,
  cloud disclosure, ZDR, and OpenRouter history contracts where they apply.

## Non-goals

- Do not give a local agent workspace-write, file-edit, shell, network-tool,
  MCP, plugin, app, browser, or subagent capabilities.
- Do not ask an agent to edit the saved file and wait for the file watcher.
- Do not parse an interactive PTY transcript as an editing protocol.
- Do not add multi-turn local-agent chat or session resume.
- Do not invoke more than one local agent in a single request.
- Do not add user-defined executables, command templates, flags, models, or
  custom agents in this iteration.
- Do not intercept `@` inside words, email addresses, inline code, code blocks,
  or frontmatter.
- Do not stream partial model text into the document.
- Do not automatically apply a whole-document result.
- Do not persist local-agent prompts, source snapshots, or results in
  Markdowner's AI History.
- Do not promise that an installed CLI is offline: each CLI may call its own
  configured local or remote provider and may have its own local retention.
- Do not change whole-document PRD, Summary, Translation, or Custom workflows.
- Do not create a release, bump the app version, or create a pull request.

## Existing Foundation

Markdowner already provides the safety-critical selected-text pipeline:

- `SelectionToolbar` exposes an AI button for an ordinary WYSIWYG text range.
- WYSIWYG positions are mapped to Markdown character offsets and then UTF-8
  byte offsets before an AI request starts.
- `AiSelectionPopover` sends one exact `custom + selection` OpenRouter request.
- Rust returns a strict selection-replacement response and validates protected
  tokens and the reconstructed document.
- the app applies a result only when document ID, source snapshot, selected
  text, byte range, operation shape, and proposed document still match;
- successful WYSIWYG application uses one `insertContentAt` transaction with
  `contentType: 'markdown'`; and
- stale or invalid results fall back to AI Review instead of mutating source.

The app also has a PTY terminal and a login-shell PATH helper. The PTY is for
interactive terminal use and is intentionally not reused here. Local-agent
execution needs bounded stdout/stderr, structured response parsing, capability
enforcement, cancellation, and a document snapshot protocol rather than an
interactive shell session.

The existing skill token registry completes `/name` and `$name`. Agent mentions
are a distinct fixed registry with `@` syntax, execution semantics, and
installation state; they must not be mixed into installed skill names.

## Approaches Considered

### 1. Content-only CLI adapter registry — selected

Create three fixed adapters behind one Rust runner. Each adapter resolves its
known executable, proves required safety capabilities, runs in an isolated
temporary directory with fixed argument arrays, receives the request through
stdin or an owned temporary file, and returns one structured Markdown result.
Markdowner validates and applies that result through editor-owned operations.

This preserves the user's existing CLI login and provider choice while keeping
document mutation deterministic and testable. It also lets the UI explain one
consistent contract despite different CLI output formats.

### 2. Direct workspace editing

Run each CLI in the open document's folder with edit tools enabled and wait for
the agent to change the file. This is familiar to coding-agent users, but it
cannot safely handle unsaved documents, bypasses editor Undo and snapshot
checks, risks unrelated workspace changes, competes with external-change
handling, and makes cancellation unable to prove what changed.

### 3. Interactive terminal relay

Start the CLI in Markdowner's existing PTY, paste the prompt, and scrape its
visible output. This preserves the native terminal experience, but ANSI output,
prompts, permissions, model thinking, upgrades, and interactive state are not a
stable machine protocol. It also cannot enforce a shared schema or know when
the final Markdown is complete.

## Product Vocabulary

- **AI actions**: the WYSIWYG selected-text panel containing OpenRouter presets
  and the local-agent entry point.
- **Local agent**: one installed CLI selected by `@claude`, `@codex`, or
  `@opencode`. "Local" describes the executable, not necessarily its model or
  provider.
- **Target**: `insert`, `selection`, or `document`, captured before a run.
- **Composer**: transient UI that owns the agent mention, prompt, target
  description, execution status, and cancellation.
- **Proposal**: validated Markdown returned by an agent before application.

## Selection Quick Actions

The OpenRouter action registry contains these stable IDs:

| ID | Label | Transformation contract |
| --- | --- | --- |
| `improve` | Improve | Improve clarity, grammar, flow, and readability while preserving meaning, facts, language, and useful Markdown structure. |
| `rewrite` | Rewrite | Rewrite substantially while preserving intent, supported facts, language, and Markdown semantics. |
| `shorten` | Shorten | Make the selection concise without dropping essential facts, decisions, constraints, or links. |
| `expand` | Expand | Add useful explanation from the selection and surrounding document context without inventing facts or commitments. |
| `make_table` | Make table | Return one valid GFM table with neutral headers and supported facts only; leave missing source fields empty. |
| `custom` | Custom instruction | Follow the user's non-empty trimmed instruction. |

Canonical instructions are English implementation strings independent of UI
localization. Selecting a preset never starts a request. `Improve` is selected
initially, while `Custom instruction` reveals and focuses the existing textarea.
The table action requires one GFM table without surrounding explanation and
passes through the same strict selection validator as every other preset.

## Local Agent Interaction Contract

### Entry points

WYSIWYG provides two equivalent local-agent entry points:

1. Select ordinary text, open `AI actions` from the floating selection toolbar,
   and choose `Local agent`.
2. With a caret or ordinary text selection, type `@` at the beginning of an
   inline text run or after whitespace. Markdowner prevents insertion of that
   trigger and opens the local-agent composer with mention completion active.

The `@` key remains ordinary document text inside a word, email address, code,
frontmatter, unsupported node, or while an IME composition is active. A
structural multi-cell table selection remains owned by the table toolbar.

The command palette adds `Run local agent` as a keyboard-accessible fallback.
In WYSIWYG it captures the current selection or caret. Source mode may open the
composer through this command, but inline `@` interception in Source mode is
outside this iteration; the original request's primary path is WYSIWYG.

### Mention completion

The composer starts with an agent field. Typing `@`, `@c`, or `@o` filters the
fixed ordered choices:

- `@claude` — Claude Code;
- `@codex` — Codex; and
- `@opencode` — OpenCode.

Installed and capability-compatible choices are enabled. Missing executables,
unsupported versions, or unprovable safety configurations remain visible but
disabled with a concise reason. Arrow keys move, Enter or Tab chooses, and
Escape closes completion without closing a running request. The selected agent
renders as a removable mention chip and can be replaced before Run.

No literal mention token is inserted into the document. Closing the composer
before a successful application leaves the document byte-for-byte unchanged.

### Prompt and target

After selecting an agent, the composer focuses a multiline prompt. Run requires
a non-empty trimmed prompt and a currently compatible target:

- a non-empty captured selection defaults to `Replace selection`;
- a collapsed caret defaults to `Insert at cursor`; and
- `Edit whole document` is always available for an open document.

The target selector names the captured document and explains whether the result
will insert, replace, or open for review. Changing from `selection` or `insert`
to `document` discards only the target choice, not the prompt or agent.

The primary button reads `Run @claude`, `Run @codex`, or `Run @opencode` for
insert and selection targets, and `Generate document proposal` for the document
target. It is the only control that starts a CLI and may consume the selected
agent's configured subscription or provider quota.

While running, agent, target, prompt, Close, and quick actions are disabled.
Cancel remains available with a status message. Partial stdout is progress
only and is never interpreted or inserted.

### Result behavior

- `insert`: insert the validated Markdown at the exact captured caret in one
  transaction, move the caret after it, publish the WYSIWYG draft, and announce
  success;
- `selection`: replace only the exact captured range in one transaction using
  Markdown parsing, publish the draft, and announce success; and
- `document`: normalize the result into a full-document replacement proposal
  and open AI Review. The source remains unchanged until explicit Apply or Open
  as new document.

If the active document, source snapshot, target text, caret, or editor mode no
longer matches, automatic insert/replace is refused. A valid result opens Review
when it can still be meaningfully compared; otherwise the composer presents a
copyable result without a mutation action.

## Local Agent Request Protocol

### Common request

The frontend invokes Rust with an opaque request ID and this bounded request:

```text
agent: claude | codex | opencode
target: insert | selection | document
documentId: captured tab identity
source: captured full Markdown source
selection: optional UTF-8 byte range
cursor: optional Markdown character offset and WYSIWYG position
instruction: trimmed user prompt
```

The Rust runner constructs the final prompt. The instruction is the requested
transformation; document content is untrusted source data and never additional
instructions. The prompt describes the exact target and requires only the
schema response. Agent-specific config files, project rules, plugins, skills,
hooks, memories, MCP servers, apps, browser tools, web search, shell tools, and
file tools are excluded from the embedded run.

Requests are passed through stdin or files created inside a request-specific
temporary directory. User text is never interpolated into shell source or a
command-line option. Executables are started directly with an argument vector;
the runner never uses `sh -c`, `zsh -c`, or a user-provided executable path.

### Structured result

Every adapter normalizes provider output to:

```json
{
  "schemaVersion": 1,
  "markdown": "# Valid Markdown\n",
  "summary": "What changed",
  "warnings": []
}
```

The object rejects unknown fields. `markdown` must be non-empty for every
target. `summary` is concise and non-empty. `warnings` contains strings only.
Embedded NUL characters, invalid UTF-8, malformed JSON, extra prose outside
the payload, output truncation, and limit overflow fail closed.

Claude Code and Codex receive their native JSON Schema options. OpenCode's JSON
event stream does not enforce a final response schema, so its adapter extracts
only the final assistant text and subjects it to the same strict local parser.
No adapter treats a Markdown code fence or best-effort JSON repair as success.

## Adapter and Capability Contracts

### Executable discovery

The backend searches the GUI process PATH and the existing login-shell PATH for
the exact executable basenames `claude`, `codex`, and `opencode`. It resolves an
absolute path before Run and passes that path directly to `Command`. Discovery
returns only kind, installed state, redacted path label, version, compatibility,
and a user-facing reason; it never returns environment values or credentials.

Status refresh runs bounded `--version`, `--help`, or feature-list probes and
checks the exact flags needed by the adapter. Version strings are informational;
capability checks, not a guessed semantic-version floor, decide compatibility.

### Claude Code

The Claude adapter requires non-interactive print mode, safe mode, empty tools,
strict empty MCP configuration, no session persistence, JSON output, and JSON
Schema support. The fixed invocation uses the installed equivalent of:

```text
claude --safe-mode --print --no-session-persistence
  --tools "" --permission-mode dontAsk
  --strict-mcp-config --mcp-config {"mcpServers":{}}
  --output-format json --json-schema <schema>
```

Safe mode excludes project/user customizations while retaining the user's
supported authentication. Empty tools and strict empty MCP config prevent tool
calls. The adapter extracts only the validated structured-output field.

### Codex

The Codex adapter requires exec mode, stdin input, ephemeral sessions,
read-only sandboxing, output schema, output-last-message, strict config, and
stable feature switches for shell and unified execution. It overrides the
effective embedded session to disable shell/unified execution, code mode,
apps, plugins, hooks, multi-agent behavior, standalone web search, and MCP
servers. The fixed invocation uses the installed equivalent of:

```text
codex exec --strict-config --sandbox read-only --ephemeral
  --skip-git-repo-check --output-schema <owned-schema-file>
  --output-last-message <owned-result-file>
  --disable shell_tool --disable unified_exec --disable code_mode
  --disable code_mode_host --disable apps --disable plugins --disable hooks
  --disable multi_agent --disable standalone_web_search
  -c mcp_servers={} -
```

Before enabling Codex, the adapter runs its feature probe with the same
overrides and confirms the execution features are false. Read-only sandboxing
is defense in depth rather than the only tool boundary. If a current Codex
build renames, removes, ignores, or rejects a required switch, the adapter is
incompatible and Run remains disabled.

### OpenCode

The OpenCode adapter requires pure mode, JSON event output, directory control,
runtime inline configuration, and resolved-config inspection. It runs in its
isolated directory with:

```text
opencode run --pure --format json --dir <owned-temp-directory>
```

`OPENCODE_CONFIG_CONTENT` disables sharing and sets every permission, including
read, edit, glob, grep, list, bash, task/subagent, skill, LSP, question,
webfetch, websearch, and external-directory access, to `deny`. Before enabling
the adapter, Markdowner runs `opencode debug config --pure` under the same
environment, parses the resolved config without logging it, and verifies every
required permission remains denied. This catches a higher-priority managed
configuration that would weaken the inline boundary. An unparseable or
insufficient effective config disables the adapter.

OpenCode does not currently expose an equivalent ephemeral-session flag.
Markdowner disables sharing and does not persist its own request, but the UI
states that OpenCode may retain local session metadata according to its own
installation and provider configuration.

## Process Isolation and Lifecycle

Each run owns an unpredictable temporary directory containing only its schema,
request, and output files. It is not a child of the document or workspace and
the prompt never reveals the original file path. Temporary file permissions are
user-only. Cleanup removes only that exact owned directory after process exit
and result parsing.

The backend inherits only the environment needed for the selected CLI's normal
authentication and provider operation, plus fixed safe overrides. Environment
contents never enter frontend events or diagnostic logs. The model cannot read
them because its tools and customizations are disabled.

Only one local-agent run per application window is allowed. The backend tracks
request ID, child process, start time, state, and cancellation token. It emits
content-free lifecycle events (`starting`, `running`, `validating`, `completed`,
`failed`, and `cancelled`). Cancel terminates the owned child and descendants as
far as the platform permits, waits for exit, and never parses partial output.

Runs have a five-minute wall-clock timeout, a bounded stdin/request size, a
2 MiB stdout/result cap, and a 64 KiB stderr cap. Limit or timeout failures kill
the process and return a stable redacted error. Stderr is never treated as
Markdown and only a short sanitized tail may appear in diagnostics.

## Local Validation and Application

Shared validation rejects malformed schemas, empty required Markdown, NULs,
oversized results, invalid target metadata, and a response for another request.
Target-specific validation then applies:

- `insert`: verify the document ID, entire source snapshot, collapsed caret,
  WYSIWYG position, and editor mode; parse the returned Markdown before one
  `insertContentAt` transaction;
- `selection`: reuse the current character/UTF-8/ProseMirror snapshot checks,
  require protected tokens from the original range, reconstruct the exact
  proposed document, and perform one Markdown insertion transaction; and
- `document`: require a current source snapshot for direct Apply, construct one
  full-range replacement proposal, and route it through Review. A changed
  source disables Apply but still permits opening the proposal as a new
  document.

Insertion and selection replacement immediately serialize the resulting
Tiptap document into the active draft. One Undo must restore the exact prior
editor content. No disk save is implicit.

Whole-document Review identifies the origin as `Claude Code`, `Codex`, or
`OpenCode`, shows the agent summary and warnings, and omits OpenRouter model,
generation, token, and cost fields. `Apply all`, `Open as new document`, Copy,
and Discard reuse existing review behavior where compatible. Rerun reopens the
local-agent composer rather than sending an OpenRouter request.

## Settings and Disclosure

AI Feature settings add a read-only `Local coding agents` section listing the
three adapters with installed version, compatible/unavailable state, and
Refresh. It does not accept executable paths, credentials, flags, or models.

The section and composer disclose:

- the executable runs locally but may contact its configured provider;
- provider use may consume a subscription, credits, or API quota;
- Markdowner does not store credentials or estimate provider cost;
- embedded runs receive the current document snapshot but no file path;
- tools are disabled and Markdowner alone applies results; and
- OpenCode may retain its own local session metadata.

OpenRouter cloud consent gates only OpenRouter actions. Local-agent execution
has its own one-time disclosure acceptance because a local CLI may still send
the snapshot to a remote provider. The setting is local and says exactly which
data is sent. Declining it keeps agent statuses visible but Run disabled.

## Error Handling

- A missing executable shows its install name and disables selection.
- An unsupported or unprovable capability set names the missing restriction
  and does not attempt a weaker invocation.
- Authentication/provider failures preserve the CLI name and a sanitized
  message, without echoing source, prompt, environment, or raw provider body.
- Missing local-agent disclosure, missing agent, empty prompt, stale target, or
  an already running request blocks Run before process creation.
- Spawn, stdin, timeout, output-limit, non-zero-exit, malformed-event,
  malformed-schema, and cancellation failures never mutate the document.
- A valid selection or cursor result with a stale target opens Review or a
  copyable proposal only; it is never redirected to the current caret.
- Tiptap insertion failure leaves the document unchanged and retains the
  validated proposal for Review.
- Closing the composer before Run preserves the document byte-for-byte.

## Data Flow

```text
WYSIWYG drag -> AI actions -> preset or Local agent
WYSIWYG boundary @ ----------^                 |
Command Palette --------------------------------|
                                                  v
                           @agent + prompt + captured target
                                                  |
                         local disclosure + compatibility gates
                                                  |
                    fixed, tool-disabled CLI adapter in owned temp dir
                                                  |
                         structured result + strict local validation
                                                  |
          +-----------------------+---------------+------------------+
          |                       |                                  |
       insert                  selection                         document
          |                       |                                  |
 exact current caret     exact current range                 AI Review
 one Undo transaction   one Undo transaction          explicit Apply/new doc
```

## Testing and Verification

### Selection action tests

- Assert the ordered preset IDs and non-empty canonical instructions.
- Resolve preset instructions and trimmed Custom input without running on
  selection.
- Assert the table instruction requires one GFM table and forbids invented
  values.
- Preserve existing key, cloud-consent, model, cancellation, validation, and
  stale-selection behavior.

### Mention and composer tests

- Open mention completion on an eligible WYSIWYG `@` key and prevent document
  insertion.
- Do not intercept email/word `@`, code, frontmatter, unsupported selections,
  or IME composition.
- Filter and keyboard-select the three fixed mentions, including disabled
  installation states.
- Capture selection, caret, and document targets without mutating the source.
- Require disclosure, compatible agent, non-empty prompt, and idle state.
- Keep prompt and target when replacing a selected agent.
- Disable mutation controls while running and expose progress/cancel/error
  states accessibly.

### Rust adapter contract tests

- Resolve only allowlisted executable basenames through GUI/login-shell PATH.
- Reject missing required flags and ignored or enabled execution capabilities.
- Snapshot each adapter's exact executable, argument vector, working directory,
  environment overrides, and input channel without exposing secrets.
- Use fake CLI executables to return Claude JSON, Codex output files, and
  OpenCode JSON events without making paid provider calls.
- Parse valid structured results and reject extra prose, malformed JSON,
  wrong schema versions, empty required Markdown, NULs, non-zero exits, and
  truncated or oversized output.
- Prove user prompts containing quotes, newlines, flags, substitutions, and
  shell syntax remain data and cannot change arguments or execute commands.
- Prove OpenCode resolved-config preflight rejects any required permission that
  is not `deny`.
- Prove cancellation and timeout terminate the owned process and discard
  partial output.
- Prove events, errors, and diagnostics exclude document, prompt, credentials,
  and raw output.

### Application integration tests

- Insert validated multiline Markdown at the exact captured WYSIWYG caret.
- Replace non-ASCII selected text using correct character and UTF-8 byte ranges.
- Convert selected prose into a native GFM table and serialize expected
  Markdown.
- Restore original content with one Undo after insertion, prose replacement,
  and table replacement.
- Reject automatic application after document, source, selection, caret, mode,
  operation, or protected-token drift.
- Open a whole-document result in Review without changing the source.
- Apply a current proposal, disable Apply for a stale source, and open either
  proposal as a new document.
- Keep source and local-agent results out of OpenRouter History and telemetry.

### Final verification

Run focused mention, composer, adapter, selection, WYSIWYG chrome, App, and Rust
tests while implementing. Before the final checkpoint, run the complete
frontend suite, complete Rust workspace tests, Clippy with warnings denied,
production build, and `git diff --check`. Review the full diff, confirm no
unrelated or secret paths are staged, push every green checkpoint immediately,
and prove local, tracking-upstream, and live-remote parity.

Do not make paid Claude Code, Codex, OpenCode, or OpenRouter requests during
automated verification. Fake executable end-to-end tests are the authoritative
process proof; an optional manual account-backed smoke test requires separate
user consent because it can consume quota and inherit provider retention.

## Primary References Checked

- Claude Code headless and CLI references, including print mode, safe mode,
  tool restriction, JSON Schema, and no-session-persistence behavior.
- OpenAI Codex CLI help and source configuration schema for exec mode,
  read-only sandboxing, ephemeral runs, output schema, and execution feature
  flags.
- OpenCode CLI help and official permissions/configuration references for pure
  mode, JSON events, inline runtime config, resolved-config inspection, and
  deny policy.

The concrete installed versions inspected during design were Claude Code
2.1.226, Codex CLI 0.147.0, and OpenCode 1.18.15. Runtime compatibility remains
capability-based so future versions fail closed when these contracts change.
