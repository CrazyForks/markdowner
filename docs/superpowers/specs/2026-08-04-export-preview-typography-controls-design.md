# Export Preview Typography Controls Design

## Summary

Markdowner's Export Preview will allow body text to shrink to 6px and will
provide independent font-size and line-height controls for fenced code blocks.
The code controls affect fenced code blocks only; inline code keeps its
existing size relative to surrounding body text.

The values belong to the existing export style, so one confirmed style is
shared by HTML, PDF, paginated image, and continuous image exports. Draft
changes remain local to Export Preview until the user confirms an export.

## Goals

- Extend the body font-size range from 10–24px to 6–24px.
- Add a 4–24px fenced-code font-size control with a 12px default.
- Add a 0.8–2.2× fenced-code line-height control with a 1.6× default.
- Apply the same confirmed values to every HTML-backed export format.
- Preserve existing stored export choices while filling in the new fields.
- Keep inline-code sizing and styling independent from fenced-code controls.

## Non-goals

- Do not add the controls to global application Settings.
- Do not create different typography values for HTML, PDF, and image exports.
- Do not add a code font-family selector.
- Do not change editor, WYSIWYG, split-view, or terminal typography.
- Do not save draft changes when Export Preview is cancelled.
- Do not change inline-code colors, presets, or its body-relative size.

## Approaches Considered

### 1. Independent fields in the shared export style — selected

Add fenced-code font size and line height to `ExportStyle`, normalize and
persist them with the existing style, and apply them in the shared standalone
HTML builder. This matches the existing data flow and keeps every export format
consistent without adding another settings surface.

### 2. Relative fenced-code sizing

Store code size as a percentage of body size. This preserves a typographic
ratio but does not let users select an exact 4px minimum and makes “independent”
control less predictable.

### 3. Per-format typography

Store separate values for HTML, PDF, and image output. This allows format-
specific tuning but multiplies controls and persisted state without a stated
need.

## User Interface Contract

The existing `Body size` range remains in the main appearance section and uses
these bounds:

- minimum: 6px;
- maximum: 24px;
- step: 1px.

The existing `Code` section gains two range controls alongside the code-theme
and inline-code controls:

- `Code block size`: 4–24px, step 1px, default 12px;
- `Code block line height`: 0.8–2.2×, step 0.1×, default 1.6×.

The controls update the live preview through the current draft-style flow.
They are disabled while an export is busy, like the surrounding controls.
Changing an export theme preserves body size, code-block size, and code-block
line height. Cancelling Export Preview discards draft changes. Confirming an
export persists the normalized values through the existing export-style
storage path.

## Data Model and Migration

`ExportStyle` gains two numeric fields:

- `codeBlockFontSize`;
- `codeBlockLineHeight`.

`DEFAULT_EXPORT_STYLE` supplies the 12px and 1.6× defaults. The existing
normalizer clamps body font size to 6–24px, code-block font size to 4–24px, and
code-block line height to 0.8–2.2×. Missing fields in legacy stored JSON receive
the new defaults. Invalid, non-finite, or out-of-range values fall back or clamp
without rejecting the rest of the saved style.

The storage key and schema envelope remain unchanged because normalization is
already the compatibility boundary for additive export-style fields. Existing
colors, theme selection, paper layout, page furniture, padding, and image
options are preserved.

## Rendering Contract

The shared standalone HTML builder remains the only typography application
point for HTML, PDF, paginated image, and continuous image exports.

- `.markdowner-export` uses `fontSize` and `lineHeight` for body content.
- fenced `pre code` uses `codeBlockFontSize` and `codeBlockLineHeight`;
- inline code outside `pre` keeps the existing `0.875em` size;
- code themes continue to control colors and syntax highlighting only.

Selectors must distinguish fenced code from inline code so an update to either
control cannot leak into the other surface. Preview regeneration continues to
use the existing request-cancellation token, preventing stale asynchronous
renders from replacing newer typography choices.

## Error Handling

- Numeric values are normalized before preview, persistence, or export.
- Legacy and malformed saved styles degrade to safe defaults instead of
  blocking Export Preview.
- The existing preview error state remains responsible for renderer failures;
  these controls add no new asynchronous or native failure mode.
- Export confirmation continues to use the normalized draft already displayed
  in the preview.

## Testing and Verification

### Unit and component tests

- Prove 6px body text and 4px fenced code are accepted.
- Prove values below and above each range are clamped.
- Prove legacy styles without either code field load with defaults while
  preserving all existing values.
- Prove save/load round trips include both new fields.
- Prove Export Preview exposes the controls with the specified labels, bounds,
  defaults, and disabled state.
- Prove changing each control regenerates preview HTML and confirmation returns
  the normalized draft.
- Prove changing themes preserves the numeric typography fields.

### Rendering tests

- Prove generated HTML applies body size to the export root.
- Prove fenced code receives its independent absolute size and unitless line
  height.
- Prove inline code retains `0.875em` behavior and does not receive fenced-code
  values.
- Exercise the same builder modes used by HTML, PDF, and both image layouts.

### Runtime verification

Build and install the release app, open Export Preview with representative body,
inline-code, and fenced-code content, then set body size to 6px and fenced code
to 4px with a visibly distinct line height. Verify the installed preview and an
exported HTML artifact contain the selected values. Run the full frontend and
Rust verification matrix, signature check, and local/tracking/live-remote Git
parity proof.

## Acceptance Criteria

- Export Preview accepts body font sizes down to 6px.
- It independently accepts fenced-code font sizes down to 4px.
- It independently adjusts fenced-code line height.
- Inline-code sizing remains body-relative and unaffected by both code-block
  controls.
- Confirmed values persist and apply to HTML, PDF, and image exports.
- Legacy saved styles load without losing existing choices.
- Cancelling Export Preview does not persist draft changes.
