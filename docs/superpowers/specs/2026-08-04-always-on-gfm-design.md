# Always-On GitHub Flavored Markdown Design

## Summary

Markdowner will treat GitHub Flavored Markdown (GFM) as its single Markdown
dialect. GFM remains enabled in WYSIWYG mode, split-view preview, and every
HTML-backed export path. The app will not expose a setting, command, badge,
banner, onboarding message, or help notice for GFM.

The implementation will harden the behavior already present in several
renderers, close any gaps found by contract tests, and prevent those renderers
from drifting apart. Existing Markdown source remains the authoritative data
and is never rewritten merely because it is opened or rendered.

## Goals

- Apply GFM by default and without an off state.
- Support GFM tables, task-list items, strikethrough, and extended autolinks.
- Keep WYSIWYG, split-view preview, HTML export, PDF export, and image export
  consistent for the same source.
- Keep raw HTML non-executable and preserve the app's existing security
  boundary.
- Prove the behavior with adapter-level and end-to-end regression tests.

## Non-goals

- Do not add a GFM preference to TypeScript or Rust settings.
- Do not add GFM UI, status text, documentation prompts, or command-palette
  entries.
- Do not add a per-document Markdown dialect or frontmatter switch.
- Do not replace the current Tiptap, Marked, React-Markdown, or remark-gfm
  stack solely to claim parser uniformity.
- Do not reinterpret ordinary soft line breaks as hard breaks.
- Do not silently normalize or rewrite source syntax when opening a document.

## Approaches Considered

### 1. Existing adapters with one tested GFM contract — selected

Keep Tiptap with Marked for WYSIWYG and React-Markdown with remark-gfm for
preview and export. Make GFM options explicit at each adapter boundary and add
shared fixtures that exercise the same extension syntax through every output.

This approach follows the existing architecture, preserves mature editing
behavior, and makes drift detectable without introducing a new parser layer.

### 2. One frontend renderer wrapper

Create a module that owns every parser and renderer option, then route
WYSIWYG, preview, and export through it. This centralizes configuration names
but cannot truly unify Tiptap's editable document model with React-Markdown's
render tree. It adds indirection without eliminating the meaningful adapter
differences.

### 3. One shared Markdown AST pipeline

Replace the current parsers with a shared GFM AST and adapt that tree into
Tiptap, React, and export HTML. This offers the strongest theoretical
consistency but is a broad editor rewrite with significant round-trip and IME
risk. It is disproportionate to the requested always-on support.

## Rendering Contract

Markdowner's GFM contract follows the extension syntax identified by the
[GitHub Flavored Markdown specification](https://github.github.com/gfm/):

| Syntax | WYSIWYG | Split view | Exports |
| --- | --- | --- | --- |
| Tables | Editable table | Semantic table | Semantic table |
| Task-list items | Editable checkbox list | Disabled checkbox list | Disabled checkbox list |
| Strikethrough | Editable strike mark | `del` element | `del` element |
| Extended autolinks | Link mark | Anchor | Anchor |
| Disallowed raw HTML | Never executable | Never executable | Never executable |

Soft line breaks remain soft because GFM does not require GitHub.com's
optional post-processing behavior. Existing explicit Markdown links and image
resolution keep their current behavior.

## Components and Data Flow

### WYSIWYG

The Tiptap Markdown extension continues to use Marked with `gfm: true` and
`breaks: false`. Table, task-list, and strike extensions remain registered, as
do their existing slash-menu, selection-toolbar, and table-editing controls.
Opening or switching to WYSIWYG parses the canonical source with these options;
editing serializes through the existing Markdown round-trip path.

### Split-view preview

React-Markdown continues to receive remark-gfm. The preview keeps the existing
source-line components, local-image resolver, syntax highlighting, skill-token
decorations, and safe raw-HTML behavior. GFM changes only Markdown parsing; it
does not bypass component overrides or content-security controls.

### Exports

The shared static HTML builder continues to receive remark-gfm before it is
used by standalone HTML, PDF, paginated image, and long-image outputs. Export
must therefore produce the same GFM structure as split view before layout and
native rendering are applied.

```text
Markdown source
  -> Tiptap + Marked(gfm: true)             -> WYSIWYG
  -> React-Markdown + remark-gfm            -> split preview
  -> React-Markdown + remark-gfm + styling  -> HTML/PDF/image export
```

## Source Preservation and Security

- Loading, previewing, exporting, or switching modes does not rewrite the
  source on its own.
- GFM syntax that cannot be represented losslessly must follow the existing
  raw-source preservation behavior rather than being discarded.
- Raw HTML and disallowed tags never become executable script in preview or
  exported documents.
- URL and image handling continue through the existing link, CSP, and asset
  protocol boundaries.

## Testing and Verification

### Contract tests

Use one representative fixture containing a table, checked and unchecked task
items, strikethrough, an extended autolink, and disallowed raw HTML. Verify:

- WYSIWYG parses the GFM constructs into the expected Tiptap nodes and marks;
- WYSIWYG serialization preserves their Markdown meaning;
- split view renders the expected semantic DOM;
- static export HTML contains the same semantic structures; and
- raw HTML remains non-executable in both React-rendered paths.

### Regression tests

- Assert Marked remains configured with GFM enabled and hard breaks disabled.
- Assert preview and export retain remark-gfm.
- Assert settings schemas and Settings UI contain no GFM field or control.
- Extend the core app flow to open the fixture and switch among WYSIWYG,
  source, and split view without losing source.

### Runtime verification

Build and install the release app, open a saved GFM fixture, and inspect:

1. its table, task list, strikethrough, and autolink in WYSIWYG;
2. the same constructs in split view; and
3. at least one exported HTML-backed artifact.

The final gate also includes the full TypeScript and Rust test suites, type
checking, Clippy, release build, installed-app signature verification, and a
clean local/tracking/live-remote Git state.

## Acceptance Criteria

- GFM is always active in WYSIWYG, split view, HTML, PDF, and image export.
- No user-facing control or explanation for GFM exists.
- Existing documents and settings load without migration.
- The supported GFM extension fixture behaves consistently across renderers.
- Raw HTML remains non-executable.
- Source is unchanged by render-only operations and mode switches.
