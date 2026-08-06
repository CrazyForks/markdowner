# WYSIWYG Link Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WYSIWYG's implicit hover/caret link editor with an explicit inspection card and transactional two-field add/edit form.

**Architecture:** A focused `linkEditing` module captures immutable ProseMirror targets and owns validated atomic mutations. `LinkPopup` becomes a closed/viewing/creating/editing state machine that consumes those operations, while App, the selection toolbar, and the slash menu publish intent without inserting placeholder content. The WYSIWYG capture-phase click interceptor routes ordinary clicks to inspection and platform modifier-clicks to the existing desktop opener.

**Tech Stack:** React 19, TypeScript 5.8, Tiptap 3/ProseMirror, Vitest 4, Testing Library, Tauri 2, CSS.

## Global Constraints

- Ordinary WYSIWYG link clicks inspect; `Cmd+click` on macOS and `Ctrl+click` elsewhere open.
- Hover and caret movement alone never open link UI.
- `Cmd+K`/`Ctrl+K`, selection-toolbar Link, and `/Link` use the same form.
- No entry point inserts text or applies/removes a link mark before Apply.
- Cancelling by button, `Escape`, outside click, blur, or tabbing out performs zero document transactions.
- `Display text` is optional; a blank or whitespace-only value falls back to the trimmed URL.
- Existing links permit both display-text and URL editing; URL-only edits preserve exact inline content and marks.
- Every insertion/update uses Tiptap `setLink()` validation; unsupported schemes do not mutate or open.
- Relative Markdown paths and `#anchor` destinations remain supported.
- Source mode and Split View preview behavior remain unchanged.
- No Tiptap UI package or new runtime dependency is added.
- Follow strict RED → verify RED → GREEN → verify GREEN cycles and push every green checkpoint immediately through `$gcpr`.

---

### Task 1: Transactional link target and mutation contract

**Files:**
- Create: `src/components/wysiwyg/linkEditing.ts`
- Create: `src/components/wysiwyg/linkEditing.test.ts`

**Interfaces:**
- Consumes: Tiptap `Editor`, `getMarkRange`, ProseMirror `Mark`/`Node`, and the editor's configured Link extension.
- Produces:

```ts
export type LinkTarget = {
  kind: 'create' | 'existing';
  from: number;
  to: number;
  sourceText: string;
  displayText: string;
  href: string;
  doc: ProseMirrorNode;
};

export type LinkCaptureResult =
  | { ok: true; target: LinkTarget }
  | { ok: false; reason: 'incompatible-selection' };

export type LinkMutationResult =
  | { ok: true; cursor: number }
  | { ok: false; reason: 'empty-url' | 'invalid-url' | 'stale-target' };

export function captureLinkTarget(
  editor: Editor,
  options?: {
    replaceRange?: { from: number; to: number };
    initialDisplayText?: string;
  },
): LinkCaptureResult;

export function captureExistingLinkTarget(
  editor: Editor,
  position: number,
): LinkTarget | null;

export function isLinkTargetCurrent(editor: Editor, target: LinkTarget): boolean;

export function isAllowedLinkHref(href: string): boolean;

export function applyLinkDraft(
  editor: Editor,
  target: LinkTarget,
  draft: { displayText: string; href: string },
): LinkMutationResult;

export function removeLinkTarget(
  editor: Editor,
  target: LinkTarget,
): LinkMutationResult;
```

- [ ] **Step 1: Write target-capture tests against a real Tiptap editor**

Create a jsdom-backed editor with `StarterKit.configure({ link: WYSIWYG_LINK_OPTIONS, codeBlock: false })`. Add literal assertions for these behaviors:

```ts
it('captures selected text without changing the document', () => {
  const editor = buildEditor('<p>Read docs now</p>');
  editor.commands.setTextSelection({ from: 6, to: 10 });
  const before = editor.getHTML();

  expect(captureLinkTarget(editor)).toMatchObject({
    ok: true,
    target: { kind: 'create', from: 6, to: 10, sourceText: 'docs', displayText: 'docs', href: '' },
  });
  expect(editor.getHTML()).toBe(before);
});

it('captures a slash replacement range with an empty initial label', () => {
  const editor = buildEditor('<p>/link</p>');
  expect(captureLinkTarget(editor, {
    replaceRange: { from: 1, to: 6 },
    initialDisplayText: '',
  })).toMatchObject({
    ok: true,
    target: { sourceText: '/link', displayText: '' },
  });
  expect(editor.getText()).toBe('/link');
});
```

Also prove that a caret/selection wholly inside one existing link captures its entire range and href, while a cross-paragraph selection returns `incompatible-selection`.

- [ ] **Step 2: Run the target tests and verify RED**

Run:

```bash
pnpm exec vitest run src/components/wysiwyg/linkEditing.test.ts --maxWorkers=1
```

Expected: FAIL because the capture API does not exist.

- [ ] **Step 3: Implement immutable target capture**

Implement full-link discovery with `getMarkRange`, probing the supplied/caret position safely at mark boundaries. A create target must use either the current selection or `replaceRange`, require both ends to share one inline parent, store the original `editor.state.doc`, and never dispatch a transaction. `sourceText` fingerprints the replaced source; `displayText` uses `initialDisplayText` when supplied.

`isLinkTargetCurrent` must require `editor.state.doc.eq(target.doc)`. This deliberately treats any document-changing transaction while the form is open as stale; selection-only transactions remain valid.

- [ ] **Step 4: Run target tests and verify GREEN**

Run the Task 1 Vitest command. Expected: all capture tests PASS.

- [ ] **Step 5: Write mutation tests before mutation code**

Add literal outcomes covering:

```ts
it('uses the URL as text when the optional label is blank', () => {
  const editor = buildEditor('<p>Before  after</p>');
  editor.commands.setTextSelection(8);
  const captured = captureLinkTarget(editor);
  if (!captured.ok) throw new Error('expected a compatible target');

  expect(applyLinkDraft(editor, captured.target, {
    displayText: '   ',
    href: ' https://example.com ',
  })).toEqual({ ok: true, cursor: 27 });
  expect(readLinks(editor)).toEqual([
    { text: 'https://example.com', href: 'https://example.com' },
  ]);
  expect(editor.getText()).toBe('Before https://example.com after');
});
```

Add separate tests for selected-text creation, URL-only existing-link edits preserving `<strong>`, simultaneous text/URL edits retaining marks shared across the complete old link, unlink preserving text, relative `./next.md`, `#heading`, empty URL, `javascript:` rejection, and a stale target after a document change. Prove `isAllowedLinkHref` accepts HTTPS, relative Markdown, and anchors but rejects empty and `javascript:` values. For every failure branch, assert `editor.getHTML()` remains the exact pre-call literal/snapshot.

- [ ] **Step 6: Run mutation tests and verify RED**

Run the Task 1 Vitest command. Expected: capture tests PASS and mutation tests FAIL because mutations are not implemented.

- [ ] **Step 7: Implement validated atomic mutations**

Implement `isAllowedLinkHref` with Tiptap Link's exported `isAllowedUri` plus a non-empty trimmed-value requirement; this is the separate safety check used by Open actions. Trim the href, reject an empty result, and call this non-dispatching editor validation before constructing any replacement transaction:

```ts
const canSet = editor
  .can()
  .chain()
  .setTextSelection({ from: target.from, to: target.to })
  .setLink({ href })
  .run();
```

When text is unchanged, select the captured range and call `setLink()` in one Tiptap chain. When text changes, intersect the non-link marks present on every text node in the target, replace the range with one text node carrying those common marks, select the replacement, and call `setLink({ href })` later in the same chain/transaction. Finish at `from + replacement.length` and focus the editor. `removeLinkTarget` selects the exact current target, calls `unsetLink()`, collapses at the old end, and focuses.

- [ ] **Step 8: Verify Task 1 and commit the green contract**

Run:

```bash
pnpm exec vitest run src/components/wysiwyg/linkEditing.test.ts --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Then explicitly stage, commit, push, and prove parity:

```bash
git add src/components/wysiwyg/linkEditing.ts src/components/wysiwyg/linkEditing.test.ts
git commit -m "feat(wysiwyg): add transactional link operations"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`.

---

### Task 2: Explicit inspection card and transactional form

**Files:**
- Modify: `src/components/wysiwyg/LinkPopup.tsx`
- Modify: `src/components/wysiwyg/LinkPopup.test.tsx`
- Modify: `src/lib/editorEvents.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: every Task 1 `linkEditing` export and `useEditorSurfaceClamp`.
- Produces:

```ts
type LinkPopupState =
  | { mode: 'closed' }
  | { mode: 'viewing'; target: LinkTarget; anchor: AnchorRect }
  | { mode: 'creating' | 'editing'; target: LinkTarget; anchor: AnchorRect; error: string | null }
  | { mode: 'invalid-create'; anchor: AnchorRect; error: string };

// editorEvents.ts payloads
interface LinkEditRequest {
  /** Removed in Task 4 after every publisher migrates; ignored by LinkPopup. */
  focusInput?: boolean;
  replaceRange?: { from: number; to: number };
  initialDisplayText?: string;
}

interface LinkInspectRequest {
  position: number;
}
```

`EditorOverlayEvent` gains `link:inspect-request`. Existing `link:open` remains the only route to App's desktop link resolver.

- [ ] **Step 1: Replace implicit-popup tests with explicit-state RED tests**

Using a real Tiptap editor, assert all of the following before editing production code:

```ts
it('does not open from caret movement or hover', async () => {
  render(<LinkPopup editor={editor} enabled />);
  editor.commands.setTextSelection(3);
  fireEvent.mouseOver(host.querySelector('a')!);
  await flushPopupFrame();
  expect(screen.queryByTestId('link-popup')).toBeNull();
});

it('opens a create form without changing the document', async () => {
  editor.commands.setTextSelection(8);
  const before = editor.getHTML();
  render(<LinkPopup editor={editor} enabled />);
  act(() => publishEditorEvent('link:edit-request', {}));
  expect(await screen.findByRole('dialog', { name: 'Add link' })).toBeInTheDocument();
  expect(editor.getHTML()).toBe(before);
});
```

Add independent tests for: inspection event → read-only card; Open event payload; Copy success and clipboard-error `role="status"`; Edit transition with populated fields; Apply new URL fallback text; Apply both existing fields; Remove preserving text; Cancel/`Escape`/outside click/blur byte-for-byte preservation; invalid URL inline error; doc-changing transaction closes stale UI; disabled mode closes; clamp/above-below placement; Tab/Shift+Tab leaving the form closes without mutation.

- [ ] **Step 2: Run LinkPopup tests and verify RED**

Run:

```bash
pnpm exec vitest run src/components/wysiwyg/LinkPopup.test.tsx --maxWorkers=1
```

Expected: failures prove the old caret/hover/blur-commit popup violates the explicit contract.

- [ ] **Step 3: Rewrite `LinkPopup` around explicit state**

Remove caret auto-open, hover listeners/timers, save-on-blur, placeholder cleanup, and custom Up/Down focus cycling. Subscribe to:

- `link:edit-request`: call `captureLinkTarget(editor, payload)`, then open `creating` or `editing` and focus/select the URL input on the next animation frame;
- `link:inspect-request`: call `captureExistingLinkTarget(editor, position)`, select its full range, and open `viewing` without moving focus into the card.

Measure anchors with `coordsAtPos(from)` and `coordsAtPos(to, -1)`. Recompute on resize/scroll and close on geometry errors. Listen to editor transactions only to close a target when a `docChanged` transaction makes `isLinkTargetCurrent` false.

Render the viewing card with a truncated URL plus Open, Copy URL, Edit, and Remove link buttons. Open must call `isAllowedLinkHref` before publishing `link:open`; an unsupported stored destination stays open with a `role="status"` error and never reaches App. Render create/edit as a `<form>` with `Display text (optional)`, `Link URL`, Apply, Cancel, and conditional Remove link. Apply calls `applyLinkDraft`; only success closes. Empty/invalid input keeps drafts and renders a specific inline error. No `onBlur` mutates the editor.

- [ ] **Step 4: Replace link popup CSS with card/form states**

Keep `.link-popup` portal positioning and color tokens. Add focused selectors for `.link-popup-card`, `.link-popup-url`, `.link-popup-form`, `.link-popup-field`, `.link-popup-actions`, `.link-popup-error`, primary/danger buttons, full input text selection in WebKit, 8px viewport margins, and a width capped by both the editor clamp and `calc(100vw - 16px)`.

- [ ] **Step 5: Verify Task 2 and commit the green UI**

Run:

```bash
pnpm exec vitest run src/components/wysiwyg/linkEditing.test.ts src/components/wysiwyg/LinkPopup.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Then:

```bash
git add src/components/wysiwyg/LinkPopup.tsx src/components/wysiwyg/LinkPopup.test.tsx src/lib/editorEvents.ts src/styles.css
git commit -m "feat(wysiwyg): add explicit link card and editor"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`.

---

### Task 3: Ordinary-click inspection and modifier-click opening

**Files:**
- Modify: `src/lib/linkOpener.ts`
- Modify: `src/lib/linkOpener.test.ts`
- Modify: `src/lib/wysiwygLinkOptions.ts`
- Modify: `src/lib/wysiwygBehavior.integration.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `link:inspect-request`, `link:open`, `isOpenLinkClick`, `isAllowedLinkHref`, and the real editor DOM.
- Produces:

```ts
interface MarkdownLinkClickHandlers {
  onInspect: (anchor: HTMLAnchorElement) => void;
  onOpen: (href: string, options: { openInNewTab: true }) => void;
}

export function attachMarkdownLinkClickInterceptor(
  surface: HTMLElement,
  handlers: MarkdownLinkClickHandlers,
): () => void;
```

- [ ] **Step 1: Write click-routing RED tests**

Change `linkOpener.test.ts` to prove an ordinary click calls `onInspect(anchor)` and never `onOpen`; macOS Cmd-click and non-macOS Ctrl-click call `onOpen(href, { openInNewTab: true })` and never inspect. Every handled link click must be default-prevented, propagation-stopped, left-button-only, contained by the editor surface, and detachable through cleanup.

Change the App tests so the former “opens a clicked WYSIWYG markdown link” case instead asserts that ordinary click does not call `resolveMarkdownLink`, `openDocument`, or `openExternalUrl`, while a subscribed `link:inspect-request` receives the editor position. Add a modifier-click case proving `javascript:` never reaches the resolver. Keep the valid modifier-click new-tab and Split View ordinary-click tests green.

Add a WYSIWYG behavior assertion that `enableClickSelection: true` is configured without re-enabling `openOnClick`, `autolink`, or `linkOnPaste`.

- [ ] **Step 2: Run click tests and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/linkOpener.test.ts src/lib/wysiwygBehavior.integration.test.ts src/App.test.tsx --maxWorkers=1
```

Expected: ordinary clicks still route to `onOpen`, so the new inspection assertions FAIL.

- [ ] **Step 3: Implement inspect/open routing**

Update the capture interceptor to find the contained anchor, prevent native WebKit navigation, and branch through the platform-aware `isOpenLinkClick(event)`. Ordinary click calls `onInspect`; modifier-click calls only `onOpen` with `openInNewTab: true`.

In App's existing editor-DOM effect, use `editor.view.posAtDOM(anchor, 0)` inside `try/catch` and publish `link:inspect-request` with that position. Modifier-click checks `isAllowedLinkHref` before continuing through `openEditorMarkdownLink`. Add `enableClickSelection: true` to `WYSIWYG_LINK_OPTIONS`. Do not alter `handleSplitPreviewClick` or Source-mode modifier-click behavior.

- [ ] **Step 4: Verify Task 3 and commit click behavior**

Run:

```bash
pnpm exec vitest run src/lib/linkOpener.test.ts src/lib/wysiwygBehavior.integration.test.ts src/components/wysiwyg/LinkPopup.test.tsx src/App.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Then:

```bash
git add src/lib/linkOpener.ts src/lib/linkOpener.test.ts src/lib/wysiwygLinkOptions.ts src/lib/wysiwygBehavior.integration.test.ts src/App.tsx src/App.test.tsx
git commit -m "fix(wysiwyg): distinguish link inspection from opening"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`.

---

### Task 4: Unified explicit creation entry points

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/wysiwyg/SelectionToolbar.tsx`
- Modify: `src/components/wysiwyg/SelectionToolbar.test.tsx`
- Modify: `src/components/wysiwyg/SlashCommandMenu.tsx`
- Modify: `src/components/wysiwyg/SlashCommandMenu.test.tsx`
- Modify: `src/lib/editorEvents.ts`

**Interfaces:**
- Consumes: Task 2 `link:edit-request` payload.
- Produces: three entry points that publish intent without placeholder mutations.

- [ ] **Step 1: Write entry-point RED tests**

For `SelectionToolbar`, subscribe to `link:edit-request`, click Link, assert one `{}` payload, and assert no `setLink`, `insertContent`, or `unsetLink` command runs.

For `/Link`, set the document text to `/link`, select the Link menu item, and assert:

```ts
expect(listener).toHaveBeenCalledWith({
  replaceRange: { from: 1, to: 6 },
  initialDisplayText: '',
});
expect(chain.deleteRange).not.toHaveBeenCalled();
expect(chain.setLink).not.toHaveBeenCalled();
expect(editor.state.doc.textBetween()).toBe('/link');
```

For App's Tiptap `handleKeyDown`, invoke Cmd+K/Ctrl+K over both collapsed and selected states, assert `preventDefault`, a single empty edit request, and no `insertContent('link')` or `setLink({ href: 'https://' })` call.

- [ ] **Step 2: Run entry-point tests and verify RED**

Run:

```bash
pnpm exec vitest run src/components/wysiwyg/SelectionToolbar.test.tsx src/components/wysiwyg/SlashCommandMenu.test.tsx src/App.test.tsx --maxWorkers=1
```

Expected: failures show all three old placeholder-mutation paths.

- [ ] **Step 3: Remove placeholder mutations and publish one intent contract**

Selection toolbar and Cmd+K/Ctrl+K publish `link:edit-request` with `{}` only. They do not query `isActive('link')`; `LinkPopup`/`captureLinkTarget` decides create versus edit. Remove the now-unused `focusInput` compatibility field from `LinkEditRequest` after all publishers migrate.

Add `'link'` to `SlashItemKind` and make the Link slash item declarative instead of giving it a mutation callback. In `runItem`, special-case `kind === 'link'`: close the menu and publish the captured slash query range as `replaceRange` with `initialDisplayText: ''`; do not call the generic `deleteRange` branch. Applying later replaces `/link`; cancelling leaves it byte-for-byte intact.

- [ ] **Step 4: Verify Task 4 and commit unified entry points**

Run:

```bash
pnpm exec vitest run src/components/wysiwyg/linkEditing.test.ts src/components/wysiwyg/LinkPopup.test.tsx src/components/wysiwyg/SelectionToolbar.test.tsx src/components/wysiwyg/SlashCommandMenu.test.tsx src/App.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Then:

```bash
git add src/App.tsx src/App.test.tsx src/components/wysiwyg/SelectionToolbar.tsx src/components/wysiwyg/SelectionToolbar.test.tsx src/components/wysiwyg/SlashCommandMenu.tsx src/components/wysiwyg/SlashCommandMenu.test.tsx src/lib/editorEvents.ts
git commit -m "feat(wysiwyg): unify explicit link creation flows"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected parity: `0 0`.

---

### Task 5: Complete regression, packaging, and runtime proof

**Files:**
- Modify only files required by a failing acceptance case; every correction gets its own failing regression test.

**Interfaces:**
- Consumes: the complete spec and Tasks 1–4.
- Produces: tested, installed, signed behavior plus clean local/tracking/live-remote parity.

- [ ] **Step 1: Run the complete automated matrix**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit --pretty false
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all frontend, packaging-script, self-update, Rust, type, and lint checks PASS. Record any baseline non-failing Vite warnings separately.

- [ ] **Step 2: Build, install, and verify the application artifact**

Run:

```bash
pnpm build:install
codesign --verify --deep --strict --verbose=2 /Applications/Markdowner.app
```

Expected: `/Applications/Markdowner.app` is replaced by the new build and passes strict deep signature verification. Report notarization separately; a local ad-hoc/development signature does not prove notarization.

- [ ] **Step 3: Exercise the installed WYSIWYG workflow**

In `/Applications/Markdowner.app`, verify with external, relative `.md`, and `#anchor` links:

1. ordinary click shows the card without navigating;
2. platform modifier-click and Open route through the desktop resolver;
3. Cmd+K, selection-toolbar Link, and `/Link` show the same form;
4. selected-text create, collapsed create with explicit text, and empty-text URL fallback serialize correctly;
5. existing display text and URL both update;
6. Cancel, Escape, outside click, blur, and tab-out preserve exact source;
7. Remove preserves text and Undo restores the link;
8. hover/caret movement do nothing;
9. keyboard focus, clipping, theme, Source mode, Split View, and mode changes remain correct.

If the macOS graphical session is unavailable, state the installed-click limitation explicitly and do not substitute source/unit evidence for GUI proof. Continue all non-GUI verification.

- [ ] **Step 4: Commit any verification correction through TDD**

For each discovered defect, write and observe a focused failing test, make the smallest production correction, run the focused and full gates, stage only its files, use a truthful Conventional Commit, push normally, and prove `0 0`. Do not create a commit when no correction is necessary.

- [ ] **Step 5: Run the completion audit and parity proof**

Re-read every acceptance criterion in `docs/superpowers/specs/2026-08-06-wysiwyg-link-management-design.md`, map it to a passing test or installed-app observation, and run:

```bash
git diff --check
git status --short --branch
git log --oneline b9a12c8..HEAD
git rev-list --left-right --count HEAD...@{u}
git ls-remote --heads origin main
```

Expected: clean worktree, local/tracking parity `0 0`, and live `origin/main` at the same final SHA. Only then report the goal complete.
