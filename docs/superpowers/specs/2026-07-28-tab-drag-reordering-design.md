# Tab Drag Reordering Design

## Goal

Make tab ordering feel dependable in the Markdowner desktop app: a user can drag any visible tab to an exact position, including when the tab strip overflows, and the reordered document sequence survives restart.

## Current Behavior and Gaps

Markdowner already marks each tab as HTML-draggable and moves it before or after the tab under the pointer. The existing path has several gaps:

- It accepts drops only over another tab. The empty strip area after the last tab is not a valid destination.
- It does not scroll an overflowing tab strip while dragging near either edge, so distant tabs can be unreachable without ending the drag.
- Drag identity lives only in React state. Drop handling should also have a synchronous source of truth so a fast drag is not dependent on a completed render.
- Dragging can start from the close button because the whole tab is draggable.
- Component tests prove callback arguments, but no application-level test proves that the reordered document paths are persisted in the same order.
- The current tests do not cover cleanup when a drag is cancelled or finishes outside a valid target.

## Product Decisions

- Keep the existing HTML drag-and-drop interaction and its native drag image. Do not add a drag-and-drop dependency or replace the interaction with a custom pointer engine.
- Preserve the current left-half/right-half rule for insertion before or after a tab.
- Treat the trailing empty part of the tab strip as “move to end.”
- Auto-scroll horizontally while the pointer remains near the left or right edge of an overflowing strip.
- Reorder only when the pointer is released. Hovering previews the insertion point but does not continuously mutate tab state.
- Keep the dragged tab active state unchanged. Reordering an inactive tab must not switch documents.
- Allow document, Settings, and Export Preview tabs to participate in the visible in-memory order. Session persistence continues to store only path-backed document tabs, in their new relative order.
- Do not initiate a tab drag from the close button.
- Existing keyboard commands for moving the active tab left or right remain unchanged.

## Interaction Model

When a drag begins, the tab strip records the source ID both synchronously and in render state. The source tab becomes partially transparent and the cursor indicates a move operation.

While the pointer is over a tab, its left or right edge receives a clear insertion marker. While the pointer is over the trailing strip area, a marker appears at the end of the last tab. Moving back over the source tab or outside a valid destination clears the marker.

When the pointer enters an edge zone of an overflowing strip, a request-animation-frame loop scrolls in that direction. Scroll speed increases with proximity to the edge so a user can reach distant tabs in one drag. Leaving the edge zone, dropping, cancelling, window blur, or component unmount stops the loop.

Dropping over a valid destination calls the reorder callback exactly once. Dropping the source onto its current effective position is a no-op. Drag end always clears transient state.

## Component and State Boundaries

`Tabs` owns only transient interaction state:

- dragged tab ID
- current insertion destination
- edge-scroll direction and animation frame

Refs hold values that must be read synchronously by native drag events. React state drives opacity and insertion-marker rendering.

The pure `reorderTabByDrag` helper remains the single ordering algorithm. It will gain an explicit move-to-end destination rather than duplicating array manipulation in the component.

`App` continues to own the `DocumentTab[]` state. Its existing open-tabs persistence effect serializes path-backed tabs in array order, so a successful reorder naturally updates the native session payload.

## Accessibility and Input Safety

- Keep the tablist and tab ARIA roles, selected state, and keyboard focus behavior.
- Expose the drag affordance through a move cursor and a concise tab title hint without changing the tab's accessible name.
- Mark the close button as non-draggable and cancel a bubbled drag start originating from interactive content.
- Do not encode an internal tab ID as ordinary `text/plain` data. Use a Markdowner-specific data-transfer type with a harmless plain-text fallback only when WebKit requires data to start a drag.
- Preserve the existing keyboard reorder commands as the non-mouse equivalent.

## Error and Edge Cases

- Unknown or stale source/target IDs produce an unchanged copy and no exception.
- A one-tab strip can begin and cancel a drag but cannot produce an ordering change.
- Dropping beyond the final tab moves the source to the end whether the source began before or after the current last document.
- Dragging the last tab into the trailing area is a no-op.
- A cancelled drag, an external drag, or a drag without Markdowner's internal type never reorders tabs.
- Auto-scroll is inactive when the strip has no horizontal overflow.
- All animation frames and global listeners are cleaned up on drag end and unmount.

## Testing and Verification

Automated tests must prove:

- the pure helper moves a source before a target, after a target, and to the end;
- unknown IDs, self-drops, and already-final move-to-end requests are no-ops;
- tab drag start publishes the internal transfer type and excludes the close button;
- left-half and right-half drops choose the correct insertion edge;
- trailing-strip drops move a tab to the end;
- edge dragging scrolls an overflowing strip and stops after drag end;
- drag cancellation clears the visual insertion state;
- an application-level drag changes rendered tab order without changing the active tab;
- the reordered path list is sent to `saveOpenTabs` in the same order.

Verification also requires the focused tests, full Vitest suite, TypeScript checking, production build, `git diff --check`, and installed Tauri/WebKit app QA with enough tabs to overflow the strip.

## Installed-App Acceptance

In the installed application:

1. Open at least six distinct Markdown documents and narrow the window until the tab strip overflows.
2. Drag a visible inactive tab before and after another tab; confirm the editor does not switch.
3. Drag a tab into the trailing empty area; confirm it becomes last.
4. Drag near each strip edge; confirm the strip scrolls and a distant destination can be reached without releasing.
5. Start a drag and cancel it; confirm no marker or dimmed tab remains.
6. Click and slightly move on a close button; confirm no tab reorder starts.
7. Quit and reopen Markdowner; confirm path-backed documents restore in the reordered sequence.

## Out of Scope

- Detaching a tab into another window
- Reordering tabs from the Explorer's Open Editors list
- Persisting the relative position of transient Settings or Export Preview tabs
- Touch-specific gestures
- Animated live tab displacement while hovering
- Changes to keyboard shortcuts or keybinding settings
