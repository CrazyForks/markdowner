/**
 * Tiny event bus shared by the floating editor overlays (link popup,
 * selection toolbar, slash menu, etc.) so they can coordinate without
 * threading callbacks through the App.tsx tree.
 *
 * Events are typed by name; the payload type is enforced at the
 * publish/subscribe site so downstream listeners stay in sync.
 */

export type EditorOverlayEvent = 'link:edit-request' | 'slash:open-at-cursor';

interface LinkEditRequest {
  /** When true, request the URL input to take focus immediately. */
  focusInput?: boolean;
}

// Empty payload reserved for future options. Kept as an object so adding a
// field later doesn't change the public event shape.
type SlashOpenAtCursorRequest = Record<string, never>;

type PayloadFor<E extends EditorOverlayEvent> = E extends 'link:edit-request'
  ? LinkEditRequest
  : E extends 'slash:open-at-cursor'
    ? SlashOpenAtCursorRequest
    : never;

type Listener<E extends EditorOverlayEvent> = (payload: PayloadFor<E>) => void;

const listeners: Map<EditorOverlayEvent, Set<Listener<EditorOverlayEvent>>> = new Map();

export function publishEditorEvent<E extends EditorOverlayEvent>(
  event: E,
  payload: PayloadFor<E>,
): void {
  const bucket = listeners.get(event);
  if (!bucket) return;
  for (const listener of bucket) {
    try {
      listener(payload);
    } catch {
      // Listeners are best-effort; swallow individual failures.
    }
  }
}

export function subscribeEditorEvent<E extends EditorOverlayEvent>(
  event: E,
  listener: Listener<E>,
): () => void {
  let bucket = listeners.get(event);
  if (!bucket) {
    bucket = new Set();
    listeners.set(event, bucket);
  }
  bucket.add(listener as Listener<EditorOverlayEvent>);
  return () => {
    bucket?.delete(listener as Listener<EditorOverlayEvent>);
  };
}
