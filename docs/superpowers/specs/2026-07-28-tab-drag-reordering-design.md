# Tab Drag Reordering Design

## Goal

Make tab ordering feel the way it does in Zed and VS Code: a user grabs any visible
tab, the tab follows the mouse, the tabs it passes slide out of its way, and the new
order is what the user sees when the button comes up. Ordering must survive an
overflowing tab strip and a restart.

## Why the HTML Drag and Drop path was abandoned

Markdowner first implemented this with the HTML Drag and Drop API, reordering the
`DocumentTab[]` array from `dragover`. That approach cannot produce the target
behavior:

- Reordering the array makes React move the drag source's DOM node. WebKit ends a
  drag session whose source node is relocated, so in the installed app the drag died
  right after the first jump.
- A tab that changes array position teleports by a full tab width. There is no way to
  animate the displaced neighbours, because their movement *is* the layout change.
- Deciding insertion from "which half of the hovered tab is the pointer over" has no
  hysteresis. The hovered element changes identity the moment the array is reordered,
  so the insertion marker flickered between the source and its neighbour.
- `dragover` only fires while a native drag session is alive, so the edge-scroll
  animation loop died with the session and distant tabs stayed unreachable.

The interaction therefore must not mutate the rendered order until the drag is over.
That rules out HTML5 drag-and-drop as the transport, because it offers no way to move
a tab without moving its node. **Do not reintroduce it.**

## Product Decisions

- Drive the drag from pointer events and paint it with CSS transforms. No
  drag-and-drop dependency, no native drag image.
- Nothing about the rendered array changes until the pointer is released. The array
  is reordered exactly once, on release.
- A tab claims the next slot once its leading edge passes that neighbour's displayed
  centre — the half-overlap rule browsers use for their own tab strips.
- The dragged tab tracks the pointer one-to-one and stays clamped inside the strip, so
  the trailing empty area resolves to "move to end" without a separate drop zone.
- Auto-scroll horizontally while the pointer stays near the left or right edge of an
  overflowing strip.
- Keep the dragged tab's active state unchanged. Reordering an inactive tab must not
  switch documents, and the click that ends a drag must not select anything.
- Allow document, Settings, and Export Preview tabs to participate in the visible
  in-memory order. Session persistence continues to store only path-backed document
  tabs, in their new relative order.
- Do not initiate a tab drag from the close button, a secondary mouse button, or a
  touch contact.
- Existing keyboard commands for moving the active tab left or right remain unchanged.

## Interaction Model

Pressing a tab arms a drag. Four pixels of horizontal travel starts it: the strip
measures every tab's box once, in content coordinates, and from then on only paints
transforms.

The dragged tab gets `translateX` with no transition, so it sits under the cursor
exactly where it was grabbed, is raised above its neighbours, and is drawn opaque. Each
tab it has passed gets `translateX(±tab width)` with a short transition, so neighbours
slide into the vacated slot instead of jumping. Because the forward and backward
thresholds are the same point, a pointer resting on a boundary cannot flip-flop
between two placements.

When the pointer enters an edge zone of an overflowing strip, a
request-animation-frame loop scrolls in that direction, faster the deeper into the zone
the pointer sits, and recomputes the target slot on every frame so a stationary pointer
keeps making progress. Leaving the zone, releasing, cancelling, window blur, or unmount
stops the loop.

Releasing the pointer commits the placement as a single move. The reorder and the
removal of every transform land in the same render, so each displaced tab is already
sitting where the new order puts it and nothing visibly jumps. Escape, `pointercancel`,
window blur, or a tab appearing or closing mid-drag cancels with no reorder.

## Component and State Boundaries

`Tabs` owns only transient interaction state: the armed pointer, the in-flight drag
(measured slots, grab offset, live index, live offsets), and the edge-scroll direction
and animation frame. A ref mirrors the drag because the window pointer handlers must
read the live placement without waiting for a render; React state drives the painted
transforms.

`src/lib/tabDragReorder.ts` holds the whole ordering model as pure functions:
`planTabDragPlacement` turns measured geometry and a pointer position into an insertion
index plus per-tab pixel offsets, and `moveTabToIndex` applies the committed index to
an array. The component contributes measurement and painting only.

`App` continues to own the `DocumentTab[]` state. Its existing open-tabs persistence
effect serializes path-backed tabs in array order, so a committed reorder naturally
updates the native session payload.

## Accessibility and Input Safety

- Keep the tablist and tab ARIA roles, selected state, and keyboard focus behavior.
- Expose the drag affordance through a grab cursor and a concise tab title hint without
  changing the tab's accessible name.
- Ignore pointer presses that originate on the close button or any
  `[data-no-tab-drag]` content.
- Ignore non-primary buttons and touch contacts, so touch scrolling of the strip is
  untouched.
- No drag payload leaves the app: nothing is written to a data transfer, so an internal
  tab id can never be dropped into an editor or another application.
- Preserve the existing keyboard reorder commands as the non-mouse equivalent.

## Error and Edge Cases

- An unknown source index or an empty strip produces zero offsets and no exception.
- A one-tab strip can be pressed and dragged but cannot produce an ordering change,
  and the press still selects the tab.
- The dragged tab is clamped to the strip, so dragging beyond the final tab moves it to
  the end whether it started before or after the current last document, and dragging
  the last tab further right is a no-op.
- A press that never crosses the movement threshold stays a click and selects the tab.
- A cancelled drag commits nothing and leaves no transform behind.
- Auto-scroll is inactive when the strip has no horizontal overflow.
- All animation frames and window listeners are released on drag end and unmount, and
  the body cursor and user-select overrides are restored.

## Testing and Verification

Automated tests must prove:

- the geometry helper reports the source's own index when the tab has not moved, the
  next index once it is half over its neighbour, every index it has passed on a long
  drag, and the same thresholds when dragging back;
- the forward and backward thresholds coincide, so a resting pointer cannot oscillate;
- each neighbour's own half width is the threshold, so uneven tab widths behave;
- the dragged tab stays clamped inside the strip, including the trailing area;
- `moveTabToIndex` moves forward, backward, and to the end, clamps out-of-range
  indices, and no-ops for an unknown id;
- a drag paints a pointer-tracking transform on the source and a transitioned
  displacement on the neighbour before release;
- exactly one reorder is committed on release regardless of how far the pointer
  wandered, and none is committed below the half-overlap threshold;
- a short press is a click and a completed drag does not select the tab;
- Escape, `pointercancel`, and window blur cancel without reordering and clear the
  transforms;
- the close button, non-primary buttons, and touch contacts never start a drag;
- edge dragging scrolls an overflowing strip, leaves a fitting strip alone, and stops
  at drag end;
- an application-level drag changes rendered tab order without changing the active tab;
- the reordered path list is sent to `saveOpenTabs` in the same order.

Verification also requires the full Vitest suite, TypeScript checking, `pnpm build`,
`git diff --check`, and installed Tauri/WebKit app QA with enough tabs to overflow the
strip.

## Installed-App Acceptance

In the installed application:

1. Open at least six distinct Markdown documents and narrow the window until the tab
   strip overflows.
2. Drag a visible inactive tab before and after another tab; confirm the tab follows
   the cursor, the neighbours slide before release, and the editor does not switch.
3. Drag a tab into the trailing empty area; confirm it becomes last.
4. Drag near each strip edge; confirm the strip scrolls and a distant destination can
   be reached without releasing.
5. Start a drag and press Escape; confirm no dimmed or displaced tab remains.
6. Click and slightly move on a close button; confirm no tab reorder starts and the tab
   closes.
7. Click a tab without dragging; confirm it activates.
8. Quit and reopen Markdowner; confirm path-backed documents restore in the reordered
   sequence.

## Out of Scope

- Detaching a tab into another window
- Reordering tabs from the Explorer's Open Editors list
- Persisting the relative position of transient Settings or Export Preview tabs
- Touch-specific gestures
- Animating the dragged tab's final snap into its slot on release
- Changes to keyboard shortcuts or keybinding settings
