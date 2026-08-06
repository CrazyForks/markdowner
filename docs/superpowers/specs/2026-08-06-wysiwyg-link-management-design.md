# WYSIWYG Link Management Design

## Summary

Markdowner's WYSIWYG editor will replace its hover- and caret-driven link
popup with an explicit contextual link card and a transactional add/edit form.
An ordinary click on an existing link opens the card instead of navigating.
`Cmd+click` on macOS, `Ctrl+click` on Windows and Linux, or the card's `Open`
action follows the link.

Creating or editing a link will not change the document until the user applies
the form. The form edits both the visible text and destination. Visible text is
optional for a new link; when it is empty, the URL becomes the inserted text.

## Goals

- Make link creation, inspection, editing, opening, copying, and removal
  discoverable from one consistent contextual surface.
- Prevent placeholder links or placeholder text from entering the document
  before confirmation.
- Make ordinary link clicks safe for editing while retaining a direct
  modifier-click navigation path.
- Support link creation from `Cmd+K`/`Ctrl+K`, the selection toolbar, and the
  `/Link` command with identical behavior.
- Allow both the visible text and URL of an existing link to be edited.
- Preserve Markdowner's relative Markdown-link and in-document anchor behavior.
- Route link insertion through Tiptap validation and link opening through the
  existing desktop resolver.

## Non-goals

- Do not enable automatic linking for bare domains, file names, or pasted URLs.
- Do not add link previews, fetched page titles, favicons, bookmarks, backlinks,
  or document search/autocomplete.
- Do not change how links behave in Source mode or Split View preview.
- Do not add a global preference for the interaction model.
- Do not install Tiptap's React UI package or replace Markdowner's existing
  editor chrome primitives.
- Do not add confirmation before unlinking; the editor's normal Undo command is
  the recovery path.

## Current Problems

The current flow has four competing triggers and commit paths:

- hovering a link opens an editable URL field;
- moving the caret into a link also opens that field;
- blurring the field commits its draft;
- an ordinary click on the rendered link navigates away.

Creating a link first applies an `https://` mark, and a collapsed-caret command
first inserts the literal text `link`. Cancellation therefore has to repair a
document mutation that should not have happened. Hover timers, editor blur,
popup focus, selection updates, and stale ranges also compete to keep the popup
alive. The repeated fixes in this area are symptoms of the interaction model,
not isolated timing defects.

## Approaches Considered

### 1. Explicit contextual card with transactional form — selected

Use a compact read-only card for an existing link and a distinct add/edit form
for mutations. Open either surface only after explicit intent. Capture the
target selection when the form opens and apply one validated transaction on
confirmation. This removes placeholder mutations and hover timing while keeping
the interaction close to the edited text.

### 2. Always-open URL field

Open the current URL input on every ordinary link click and retain its inline
actions. This is a smaller code change, but inspection and mutation remain
conflated, visible text still needs another editing path, and accidental focus
or blur can still feel like an implicit save.

### 3. Modal link dialog

Use an application-level dialog with visible-text and URL inputs. This offers
stable focus and simple geometry, but it removes context, interrupts fast
keyboard editing, and is disproportionate for an inline mark.

## Interaction Contract

### Existing links

An ordinary left click on an existing WYSIWYG link prevents WebKit navigation
and opens a contextual card anchored to the full link range. It does not enter
edit mode automatically. The card provides these actions:

- `Open`: follow the destination through Markdowner's existing link resolver;
- `Copy URL`: copy the raw destination and show transient copied feedback;
- `Edit`: replace the card with the edit form;
- `Remove link`: remove only the link mark, preserve its visible content, close
  the card, and leave the change available to Undo.

`Cmd+click` on macOS and `Ctrl+click` on Windows and Linux bypasses the card and
opens the destination directly. Unsupported schemes never navigate. Split View
preview retains its current ordinary-click navigation behavior because it is a
preview surface rather than an editable surface.

Hovering a link or moving the caret through it never opens UI. `Escape`, an
ordinary click outside the card/form, a mode change, or removal of the target
from the document closes the surface.

### Adding links

`Cmd+K`/`Ctrl+K`, the selection-toolbar Link button, and `/Link` all publish the
same explicit edit request. None of them inserts text or applies a mark before
confirmation.

When text is selected within one inline editing range, the form captures that
range and pre-fills `Display text` with its plain visible text. When the
selection is collapsed, `Display text` starts empty. `Link URL` starts empty
and receives initial focus so a URL can be pasted and confirmed quickly.

`Display text` is optional:

- if it is non-empty, that value becomes the linked text;
- if it is empty, the trimmed URL becomes the linked text;
- surrounding text is never replaced.

A selection spanning incompatible block or structural boundaries cannot be
flattened into one Markdown link. In that case the link action does not mutate
the document and the form explains that text within a single paragraph or
inline container must be selected.

### Editing links

Choosing `Edit` on the card, or invoking `Cmd+K`/`Ctrl+K` while the selection is
inside an existing link, opens the same form with both fields populated. The
form targets the entire link even when the caret is placed in the middle of it.

Changing only the URL preserves the linked inline content exactly, including
other marks. Changing `Display text` replaces the link's text as one atomic
edit. Marks that cover the complete original link are retained; mixed marks
that cover only part of the old text are not projected onto differently sized
replacement text. The link mark covers the complete new text.

### Form controls and keyboard behavior

The form contains:

- `Display text (optional)`;
- `Link URL`;
- `Apply`;
- `Cancel`;
- `Remove link` only when editing an existing link.

`Enter` applies when the URL is valid. `Escape` cancels. `Tab` and `Shift+Tab`
move through controls in DOM order; the form does not use the current custom
Up/Down focus loop and does not insert editor tab characters. Tabbing beyond
the form closes it without mutation and returns focus to the captured editor
boundary. Applying, cancelling, or removing also returns focus to the editor at
the resulting link boundary.

Cancelling by button, `Escape`, or outside click performs zero document
transactions. There is no save-on-blur behavior.

## Architecture and Components

### Link target and transaction helpers

A focused WYSIWYG link-editing module owns link-target discovery and mutations.
It exposes typed operations to:

- derive an existing full link range from a click, caret, or selection;
- capture a create target without changing the editor;
- read the target's visible text, destination, and marks;
- verify that the captured target still refers to the same document content;
- validate and atomically create, update, or remove a link.

The UI consumes these operations rather than assembling Tiptap command chains
in `App.tsx`, the selection toolbar, and the slash menu. This removes the three
duplicated placeholder-link implementations.

### Link popup state

The existing `LinkPopup` integration point remains, but its state becomes an
explicit state machine:

- `closed`;
- `viewing` an existing link;
- `editing` an existing link;
- `creating` from a saved selection or caret.

Only explicit click and edit-request events enter an open state. The component
continues to use the existing portal, editor-surface clamping, above/below
placement, and application event bus. Hover listeners, hide timers,
caret-auto-open listeners, and blur commits are removed.

### Click routing

The WYSIWYG capture-phase click interceptor continues to cancel native WebKit
anchor navigation. It distinguishes two outcomes:

- ordinary click: select/inspect the link without calling the open resolver;
- platform modifier-click: call the open resolver and suppress the card.

The generic Source-mode and Split View link behavior remains unchanged.
Tiptap's click-selection support is enabled so a clicked link becomes a stable
editing target, but the card still derives and validates the full mark range
rather than trusting a DOM selection alone.

### Styling

The card and form reuse Markdowner's popover colors, borders, spacing, focus
rings, and surface-clamping behavior. The card remains compact; the two-field
form may be wider but must stay within the editor surface and viewport. Long
URLs are truncated in the card while the input preserves and exposes the full
value.

## Data Flow

### Create

1. An explicit entry point publishes a link-edit request.
2. `LinkPopup` captures the current compatible selection or caret and opens
   `creating` state without dispatching an editor transaction.
3. The user edits local React drafts.
4. Apply validates the URL through Tiptap's Link extension.
5. One editor transaction inserts/replaces only the captured range and applies
   the link mark.
6. The surface closes and editor focus moves to the new link boundary.

### Inspect and edit

1. An ordinary click is intercepted before WebKit navigation.
2. The full link range is derived and the `viewing` card opens.
3. `Edit` copies the current visible text and URL into local drafts.
4. Apply revalidates the target and URL, then performs one editor transaction.
5. `Cancel` discards only the drafts; `Remove link` dispatches one unlink
   transaction.

## Validation and Error Handling

- An empty or whitespace-only URL cannot be applied.
- Link insertion and modification use Tiptap `setLink()`/Link-extension
  validation; the UI does not write raw anchor attributes.
- Markdowner's supported relative paths and `#anchor` targets remain valid.
- Opening a link never calls `window.open` or directly trusts the draft. It
  uses the existing resolver, which classifies Markdown documents, local files,
  anchors, external URLs, and unresolved targets before taking an action.
- If the captured range no longer matches its original text/link identity
  after a document-changing transaction, Apply aborts instead of mutating a
  nearby range. The surface closes immediately and returns focus to the current
  editor selection.
- A clipboard failure leaves the card open, exposes a concise `role="status"`
  message, and keeps the URL available for manual selection and copying.
- Geometry failures close the surface for that interaction rather than placing
  it at an unrelated screen position.
- Invalid input remains in the form with an inline error and does not alter the
  document.

## Testing and Verification

### Link operation tests

- Create from selected text without a pre-confirmation transaction.
- Create at a collapsed caret with explicit display text.
- Create at a collapsed caret with empty display text and insert the URL as the
  visible text.
- Edit URL only while preserving the exact inline content and marks.
- Edit visible text and URL atomically across the full link range.
- Remove only the link mark and preserve visible text.
- Reject empty, unsupported, incompatible-range, and stale-target operations
  without changing the document.
- Preserve relative Markdown paths and in-document anchors.

### Component and integration tests

- Ordinary click opens the read-only card and never calls link navigation.
- Platform modifier-click opens the link and never opens the card.
- `Cmd+K`/`Ctrl+K`, selection toolbar, and `/Link` open the same form without
  inserting `link` or applying `https://` first.
- A command inside an existing link opens populated edit state for the full
  link.
- `Enter` applies; `Escape`, Cancel, outside click, and blur cancel without a
  document transaction.
- Open, Copy URL, Edit, Apply, Cancel, and Remove link are keyboard accessible.
- Hover and caret movement alone never open the card or form.
- The surface flips and clamps correctly near editor and viewport edges.
- Source mode and Split View preview keep their current click behavior.

### Runtime verification

Build and install the application, then exercise the complete workflow in the
installed WYSIWYG editor with an external URL, a relative Markdown path, and an
anchor target. Verify ordinary click inspection, modifier-click/open action,
creation with and without selected text, URL fallback text, visible-text and
URL edits, cancellation, removal, Undo, keyboard focus, and mode switching.
Run the full frontend and Rust test matrix, TypeScript checking, Clippy, package
installation, signature verification, and local/tracking/live-remote parity.

## Acceptance Criteria

- An ordinary click on a WYSIWYG link opens an inspection card and does not
  navigate.
- Modifier-click and the card's Open action follow the link through Markdowner.
- Hover and caret movement do not open link UI.
- All three creation entry points use one form and make no document change
  before Apply.
- New links accept optional display text and use the URL as visible text when
  it is blank.
- Existing links allow both visible text and URL editing.
- Cancel and outside dismissal leave the source Markdown byte-for-byte
  unchanged.
- Remove link preserves visible text and is recoverable through Undo.
- Invalid or stale edits never mutate the wrong range or bypass URL validation.
- Relative Markdown links, anchors, Source mode, and Split View preview retain
  their existing behavior.

## References

- [Tiptap Link Popover](https://tiptap.dev/docs/ui-components/components/link-popover)
- [Tiptap Link extension](https://tiptap.dev/docs/editor/extensions/marks/link)
- [Tiptap link popover security incident](https://tiptap.dev/docs/resources/incidents/06-25-2025-link-popover)
- [Lexical releases: floating link editor fixes](https://github.com/facebook/lexical/releases)
