# H1-H4 Heading Support Design

## Summary

Markdowner will treat H1 through H4 as its complete heading-authoring surface
and render those four levels as a coherent hierarchy in WYSIWYG, split preview,
standalone preview, HTML export, and PDF export.

Existing Markdown that contains H5 or H6 remains losslessly readable,
navigable, and serializable. Those compatibility levels are not offered as new
heading choices in WYSIWYG commands or keyboard-driven heading conversion.

## Product Decisions

- H1-H4 are the supported authoring levels.
- H5/H6 remain compatibility levels so opening and saving an older or external
  document cannot silently change its structure.
- The WYSIWYG slash menu and `Cmd+/` Turn into menu expose exactly H1-H4.
- Markdown input rules convert `# ` through `#### ` into headings. Five or six
  hashes typed in a paragraph remain literal text instead of creating a new
  H5/H6 block.
- Heading keyboard shortcuts are available only for H1-H4. Existing H5/H6
  blocks can still be viewed, selected, copied, and round-tripped.
- Source mode continues to accept standard Markdown H1-H6 because it is a
  lossless source editor; limiting source syntax would alter user-owned files.
- Outline parsing continues to include H1-H6 so preserved compatibility
  headings remain navigable.

## Goals

- Make H4 creation and conversion work through every WYSIWYG authoring path.
- Give H1-H4 a distinct but restrained typographic hierarchy.
- Keep WYSIWYG and split preview visually aligned.
- Keep HTML and PDF exports aligned with the in-app document hierarchy.
- Preserve existing H5/H6 source without normalization or data loss.
- Cover behavior, presentation, export output, and production build paths with
  focused regression tests.

## Non-goals

- This work does not redesign document typography settings or add per-level
  user customization.
- This work does not remove H5/H6 support from Markdown parsing, source mode,
  outline navigation, or export compatibility.
- This work does not rewrite existing H5/H6 headings to H4 or paragraphs.
- This work does not add an always-visible block-format toolbar.
- This work does not change heading anchors, imported theme scoping, or PDF
  pagination algorithms.

## Heading Contract

Markdowner's heading extension will separate schema compatibility from
authoring affordances:

- the ProseMirror schema parses and renders heading levels 1 through 6;
- input rules and keyboard shortcuts create only levels 1 through 4;
- explicit WYSIWYG menu commands offer only levels 1 through 4.

The extension remains configured in both the production editor and the browser
playground so runtime QA exercises the same contract. The shared level sets are
kept in one focused module to prevent the menus, editor extension, and tests
from drifting independently.

## Interaction Design

### WYSIWYG input

Typing one to four hashes followed by a space at the start of a paragraph
converts that paragraph to the corresponding heading. `#### ` therefore becomes
H4 with the same native input-rule behavior already used by H1-H3.

Typing five or six hashes followed by a space does not create H5/H6. The input
stays ordinary paragraph text, allowing users to correct it without an
unexpected unsupported block conversion.

### Slash and Turn into menus

The block menu lists `Heading 1`, `Heading 2`, `Heading 3`, and `Heading 4` in
order after `Text`. `Heading 5` is removed. Search aliases such as `h4`,
`heading`, `제목4`, and `헤딩` continue to resolve the H4 item.

Both typed-slash insertion and `Cmd+/` conversion use the same four items.
Converting a selection to H4 must retain the selected text and change only its
block type.

### Existing H5/H6 documents

When a document already contains H5/H6, WYSIWYG renders those nodes without
dropping their depth. A no-op mode switch or save returns the original heading
levels. The outline continues to show them at depths 5 and 6. They receive a
quiet compatibility style close to body size so they remain readable without
appearing as supported authoring choices.

## Visual Hierarchy

The four supported levels use the following relative scale, based on the
editor or export body size:

| Level | Size | Weight | Rhythm |
| --- | ---: | --- | --- |
| H1 | `1.875em` | Bold | Strong section break |
| H2 | `1.5em` | Semibold | Strong section break |
| H3 | `1.25em` | Semibold | Medium section break |
| H4 | `1.125em` | Semibold | Compact subsection break |

The existing leading-H1 page-title treatment remains unchanged. H4 receives
less top margin than H1-H3 and a compact bottom margin so it groups naturally
with the paragraph or list that follows. H5/H6 retain body-sized compatibility
styling with modest emphasis.

The same scale and rhythm apply to:

- the `.markdown-surface` base used by preview and exports;
- split preview's WYSIWYG-parity overrides;
- the editable ProseMirror surface;
- export-specific style overrides used by HTML and PDF generation.

Export-specific font size, line height, paragraph spacing, colors, and content
padding continue to scale the relative heading values instead of being
replaced by fixed pixels.

## Rendering and Export Flow

1. Source Markdown is parsed by the existing Tiptap Markdown or
   React-Markdown path.
2. WYSIWYG uses the compatibility heading schema and restricted authoring
   rules.
3. Split and standalone previews render semantic `h1` through `h6` elements
   through the existing source-line components.
4. `buildExportHtml()` uses the same React-Markdown rendering for both HTML and
   PDF inputs.
5. Shared document CSS plus the export style block provides the final H1-H4
   hierarchy; PDF pagination receives the already-styled semantic HTML.

No new export parser or PDF-only heading path is introduced. A single semantic
HTML path keeps HTML and PDF behavior aligned.

## Error and Compatibility Handling

- Unsupported heading attributes fall back through the existing Tiptap
  extension behavior rather than producing invalid tags.
- H5/H6 parsing remains enabled even though creation shortcuts are disabled.
- Imported custom themes remain able to override document heading styles
  through the existing scoped theme rules.
- Documents containing headings inside fenced code blocks remain unaffected;
  the Markdown parser continues to treat those hashes as code.
- Long or page-boundary headings continue through the existing PDF pagination
  placement logic. This feature changes typography, not pagination semantics.
- If an export-specific override is missing, regression tests fail on the
  generated self-contained HTML before the PDF renderer is invoked.

## Testing and Verification

### WYSIWYG behavior

- `# `, `## `, `### `, and `#### ` create H1-H4 respectively.
- `##### ` and `###### ` remain paragraph text.
- Markdown containing H1-H6 parses and serializes with all depths preserved.
- H4 survives WYSIWYG editing and a Markdown round trip.

### Menus

- Slash insertion and Turn into expose H1-H4 in order and omit Heading 5.
- Filtering for `h4` selects Heading 4.
- Activating Heading 4 creates or converts a level-4 heading without deleting
  selected text.

### Preview and styles

- Preview renders semantic H1-H4 elements with source-line metadata.
- Stylesheet contract tests cover H4 in base preview, split preview, and
  ProseMirror selectors.
- H4 is smaller and more compact than H3 while remaining distinct from body
  text.

### HTML and PDF

- Generated HTML contains semantic `h1` through `h4` elements.
- Generated HTML contains the complete H1-H4 export style contract.
- The production/minified PDF pagination test continues to pass.
- Runtime QA checks one document containing H1-H4 in split preview and export
  preview, then verifies standalone HTML and an exported PDF.

### Completion gates

- Focused Vitest suites for WYSIWYG behavior, slash commands, preview, styles,
  and export generation.
- Full `pnpm test` serial suite.
- TypeScript checking and the production build.
- `pnpm sync-version -- --check` and locked Cargo metadata after the release
  version is synchronized.
- `git diff --check`, explicit-path commits, ordinary pushes, and final
  local/upstream/live-remote parity.

## Commit Sequence

1. Commit and push this design document.
2. Implement and push the H1-H4 authoring contract, visual hierarchy, and
   regression coverage as one green user-visible feature checkpoint.
3. Bump the Headatever patch version, synchronize application metadata,
   verify the release build and artifacts, then push the release commit and
   annotated tag without rewriting history.
