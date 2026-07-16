# Export Preview Responsive Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the PDF Export Preview page visible at narrow application sizes and add preview-only Fit, zoom-out, and zoom-in controls without changing exported output.

**Architecture:** Extract deterministic paper-size and zoom calculations into a small library, then let `ExportPreviewTab` own transient Fit/manual state plus a `ResizeObserver` measurement of the PDF canvas. The responsive grid bounds Config and guarantees Preview height below `lg`, while the PDF page uses a fixed 760px base sheet inside a scaled layout wrapper so transforms and scroll ranges agree.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, Testing Library, Tauri 2, Headatever, pnpm

---

## Task 1: Add deterministic PDF preview zoom math

**Files:**
- Create: `src/lib/exportPreviewZoom.ts`
- Test: `src/lib/exportPreviewZoom.test.ts`

- [ ] **Step 1: Write the failing zoom-model tests**

Create `src/lib/exportPreviewZoom.test.ts` with table-driven coverage for A4 and Letter page dimensions, Fit width/height bounds, the 100% Fit cap, zero-size fallback, irregular Fit stepping, and manual clamping:

```ts
import { describe, expect, it } from 'vitest';

import {
  PREVIEW_PAGE_WIDTH_PX,
  fitPreviewZoomPercent,
  previewPageSize,
  stepPreviewZoomPercent,
} from './exportPreviewZoom';

describe('exportPreviewZoom', () => {
  it('derives A4 and Letter page heights from the 760px base width', () => {
    expect(previewPageSize('A4')).toEqual({
      width: PREVIEW_PAGE_WIDTH_PX,
      height: PREVIEW_PAGE_WIDTH_PX * (297 / 210),
    });
    expect(previewPageSize('Letter')).toEqual({
      width: PREVIEW_PAGE_WIDTH_PX,
      height: PREVIEW_PAGE_WIDTH_PX * (11 / 8.5),
    });
  });

  it.each([
    [{ width: 380, height: 1000 }, 50],
    [{ width: 760, height: PREVIEW_PAGE_WIDTH_PX * (297 / 210) * 0.5 }, 50],
    [{ width: 1520, height: PREVIEW_PAGE_WIDTH_PX * (297 / 210) * 2 }, 100],
    [{ width: 0, height: 500 }, 100],
  ])('fits A4 into %o at %s%%', (viewport, expected) => {
    expect(fitPreviewZoomPercent(viewport, previewPageSize('A4'))).toBe(expected);
  });

  it('rounds irregular Fit values to manual 10% steps and clamps them', () => {
    expect(stepPreviewZoomPercent(53, 'out')).toBe(50);
    expect(stepPreviewZoomPercent(53, 'in')).toBe(60);
    expect(stepPreviewZoomPercent(25, 'out')).toBe(25);
    expect(stepPreviewZoomPercent(200, 'in')).toBe(200);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm exec vitest run src/lib/exportPreviewZoom.test.ts
```

Expected: FAIL because `src/lib/exportPreviewZoom.ts` does not exist.

- [ ] **Step 3: Implement the zoom model**

Create `src/lib/exportPreviewZoom.ts`:

```ts
export const PREVIEW_PAGE_WIDTH_PX = 760;
export const PREVIEW_ZOOM_MIN_PERCENT = 25;
export const PREVIEW_ZOOM_MAX_PERCENT = 200;
export const PREVIEW_ZOOM_STEP_PERCENT = 10;

export type PreviewPaperSize = 'A4' | 'Letter';
export type PreviewZoomDirection = 'in' | 'out';

export interface PreviewSize {
  width: number;
  height: number;
}

export function previewPageSize(paperSize: PreviewPaperSize): PreviewSize {
  return {
    width: PREVIEW_PAGE_WIDTH_PX,
    height: PREVIEW_PAGE_WIDTH_PX * (paperSize === 'A4' ? 297 / 210 : 11 / 8.5),
  };
}

export function fitPreviewZoomPercent(
  viewport: PreviewSize,
  page: PreviewSize,
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || page.width <= 0 || page.height <= 0) {
    return 100;
  }
  return Math.max(
    1,
    Math.floor(Math.min(viewport.width / page.width, viewport.height / page.height, 1) * 100),
  );
}

export function stepPreviewZoomPercent(
  current: number,
  direction: PreviewZoomDirection,
): number {
  const stepped = direction === 'in'
    ? Math.floor(current / PREVIEW_ZOOM_STEP_PERCENT + 1) * PREVIEW_ZOOM_STEP_PERCENT
    : Math.ceil(current / PREVIEW_ZOOM_STEP_PERCENT - 1) * PREVIEW_ZOOM_STEP_PERCENT;
  return Math.min(PREVIEW_ZOOM_MAX_PERCENT, Math.max(PREVIEW_ZOOM_MIN_PERCENT, stepped));
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run:

```bash
pnpm exec vitest run src/lib/exportPreviewZoom.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the model locally**

```bash
git add src/lib/exportPreviewZoom.ts src/lib/exportPreviewZoom.test.ts
git commit -m "feat(export): add preview zoom model"
git status --short
```

Expected: the two model files are committed and the remaining working tree is clean.

## Task 2: Bound the responsive layout and render a scaled PDF sheet

**Files:**
- Modify: `src/shell/ExportPreviewTab.tsx`
- Modify: `src/shell/ExportPreviewTab.test.tsx`

- [ ] **Step 1: Add a reusable ResizeObserver test harness**

At the top of `ExportPreviewTab.test.tsx`, capture the latest observer callback and install a mock before each test:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let resizeObserverCallback: ResizeObserverCallback | null = null;

class MockResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function resizePdfViewport(width: number, height: number) {
  resizeObserverCallback?.(
    [{ contentRect: { width, height } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
}

beforeEach(() => {
  resizeObserverCallback = null;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Write failing component tests for layout and initial Fit**

Add tests that render a PDF request and assert:

```ts
it('bounds the narrow Config row and guarantees Preview height', () => {
  renderPreview({ request: { ...HTML_REQUEST, format: 'pdf' } });
  expect(screen.getByTestId('export-preview-layout')).toHaveClass(
    'grid-rows-[minmax(180px,2fr)_minmax(240px,3fr)]',
    'lg:grid-cols-[300px_minmax(0,1fr)]',
    'lg:grid-rows-1',
  );
  expect(screen.getByTestId('export-preview-config')).toHaveClass('min-h-0', 'overflow-y-auto');
});

it('starts PDF preview in Fit with accessible controls and a scaled page wrapper', () => {
  renderPreview({ request: { ...HTML_REQUEST, format: 'pdf' } });
  expect(screen.getByRole('group', { name: 'Preview zoom controls' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Fit preview' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Preview zoom: 100%')).toBeInTheDocument();
  expect(screen.getByTestId('pdf-preview-page')).toHaveStyle({
    width: '760px',
    transform: 'scale(1)',
    transformOrigin: 'top left',
  });
});

it('keeps HTML preview responsive without PDF zoom controls', () => {
  renderPreview();
  expect(screen.queryByRole('group', { name: 'Preview zoom controls' })).toBeNull();
  expect(screen.queryByTestId('pdf-preview-page')).toBeNull();
  expect(screen.getByTitle('HTML export preview')).toHaveClass('min-h-[520px]');
});
```

- [ ] **Step 3: Run the focused component tests and confirm RED**

Run:

```bash
pnpm exec vitest run src/shell/ExportPreviewTab.test.tsx
```

Expected: FAIL because the responsive test IDs, bounded tracks, PDF toolbar, and fixed base sheet are absent.

- [ ] **Step 4: Implement the responsive shell and PDF page geometry**

In `ExportPreviewTab.tsx`:

- Import `Minus`, `Plus`, and `Scan` from `lucide-react`.
- Import the zoom-model helpers and constants.
- Add `zoomMode`, `manualZoomPercent`, `previewViewport`, and `previewViewportRef`.
- Observe the PDF viewport only when PDF is active; ignore zero-sized updates.
- Calculate `pageSize`, `fitZoomPercent`, `zoomPercent`, and `zoomScale`.
- Replace the narrow grid rows with `minmax(180px,2fr) minmax(240px,3fr)` and add `min-h-0` to both children.
- Make Preview a `flex min-h-0 flex-col overflow-hidden` region with a shrink-free toolbar and an independently scrolling viewport.
- Render PDF and HTML preview branches separately so HTML keeps its current responsive sizing.

The key PDF geometry must be:

```tsx
const pageSize = previewPageSize(draftStyle.paperSize);
const fitZoomPercent = fitPreviewZoomPercent(previewViewport, pageSize);
const zoomPercent = zoomMode === 'fit' ? fitZoomPercent : manualZoomPercent;
const zoomScale = zoomPercent / 100;

<div
  data-testid="pdf-preview-wrapper"
  className="relative shrink-0"
  style={{ width: pageSize.width * zoomScale, height: pageSize.height * zoomScale }}
>
  <div
    data-testid="pdf-preview-page"
    className="relative overflow-hidden border border-black/10 shadow-[0_28px_90px_-36px_rgba(0,0,0,0.62)]"
    style={{
      width: pageSize.width,
      height: pageSize.height,
      backgroundColor: draftStyle.backgroundColor,
      transform: `scale(${zoomScale})`,
      transformOrigin: 'top left',
    }}
  >
    {/* Existing iframe and preview status overlays. */}
  </div>
</div>
```

- [ ] **Step 5: Run the component test and confirm the layout slice is GREEN**

Run:

```bash
pnpm exec vitest run src/shell/ExportPreviewTab.test.tsx
```

Expected: the new layout, initial Fit, fixed-page, and HTML-boundary assertions pass; lifecycle assertions added in Task 3 are not present yet.

## Task 3: Implement manual zoom, Fit lifecycle, and request reset

**Files:**
- Modify: `src/shell/ExportPreviewTab.tsx`
- Modify: `src/shell/ExportPreviewTab.test.tsx`

- [ ] **Step 1: Write failing interaction and lifecycle tests**

Add tests that prove all transient behavior and the export-style boundary:

```ts
it('switches from Fit to manual zoom without changing the confirmed style', () => {
  const onConfirm = vi.fn();
  renderPreview({ request: { ...HTML_REQUEST, format: 'pdf' }, onConfirm });

  resizePdfViewport(403, 600); // A4 Fit = 53%
  expect(screen.getByText('Preview zoom: 53%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(screen.getByText('Preview zoom: 60%')).toBeInTheDocument();

  resizePdfViewport(304, 430);
  expect(screen.getByText('Preview zoom: 60%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
  expect(onConfirm).toHaveBeenCalledWith(DEFAULT_EXPORT_STYLE);
});

it('re-enables responsive Fit and resets Fit for a new request', () => {
  const request = { ...HTML_REQUEST, format: 'pdf' as const };
  const { rerender } = renderPreview({ request });
  resizePdfViewport(403, 600);
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(screen.getByText('Preview zoom: 60%')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Fit preview' }));
  expect(screen.getByText('Preview zoom: 53%')).toBeInTheDocument();
  resizePdfViewport(304, 430);
  expect(screen.getByText('Preview zoom: 40%')).toBeInTheDocument();

  rerender(
    <ExportPreviewTab
      request={{ ...request, title: 'notes-2', source: '# Notes 2' }}
      initialStyle={DEFAULT_EXPORT_STYLE}
      appTheme="light"
      busy={false}
      onCancel={() => {}}
      onConfirm={() => {}}
      buildPreview={previewBuilder()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Fit preview' })).toHaveAttribute('aria-pressed', 'true');
});
```

Also assert zoom-out rounds `53%` to `50%`, the buttons disable at `25%`/`200%`, busy state disables all three zoom buttons, and changing paper size preserves the current Fit/manual mode.

- [ ] **Step 2: Run focused component tests and confirm RED**

Run:

```bash
pnpm exec vitest run src/shell/ExportPreviewTab.test.tsx
```

Expected: FAIL on interactions, resize behavior, or request reset until handlers and lifecycle are implemented.

- [ ] **Step 3: Implement zoom handlers and lifecycle**

Use these state transitions:

```ts
const applyManualZoom = (direction: PreviewZoomDirection) => {
  const next = stepPreviewZoomPercent(zoomPercent, direction);
  setManualZoomPercent(next);
  setZoomMode('manual');
};

const fitPreview = () => setZoomMode('fit');
```

In the existing request-identity effect, reset zoom only when `requestIdentity` changes:

```ts
if (requestChanged) {
  setDraftStyle(resolveExportStyleForTheme(initialStyle, appTheme));
  setZoomMode('fit');
  setManualZoomPercent(100);
  return;
}
```

Render an accessible toolbar:

```tsx
<div role="group" aria-label="Preview zoom controls">
  <Button aria-label="Zoom out" disabled={busy || zoomPercent <= 25} onClick={() => applyManualZoom('out')} />
  <output aria-label={`Preview zoom: ${zoomPercent}%`}>Preview zoom: {zoomPercent}%</output>
  <Button aria-label="Zoom in" disabled={busy || zoomPercent >= 200} onClick={() => applyManualZoom('in')} />
  <Button aria-label="Fit preview" aria-pressed={zoomMode === 'fit'} disabled={busy} onClick={fitPreview}>Fit</Button>
</div>
```

- [ ] **Step 4: Run focused model and component tests**

Run:

```bash
pnpm exec vitest run src/lib/exportPreviewZoom.test.ts src/shell/ExportPreviewTab.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the complete UI slice locally**

```bash
git add src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx
git commit -m "feat(export): keep PDF preview visible with zoom controls"
git status --short
```

Expected: component and component tests are committed; no unrelated files are staged.

## Task 4: Verify code quality and the installed desktop application

**Files:**
- Verify only; fix the files from Tasks 1–3 if a gate exposes a defect.

- [ ] **Step 1: Run focused tests from a clean process**

```bash
pnpm exec vitest run src/lib/exportPreviewZoom.test.ts src/shell/ExportPreviewTab.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run all automated project gates**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: every command exits 0. If a gate fails, diagnose and fix the root cause, rerun its focused regression first, then rerun all four commands.

- [ ] **Step 3: Install and open the verified debug application**

```bash
pnpm build:install:debug:open
```

Expected: Markdowner launches from the installed debug app bundle rather than a browser-only mock.

- [ ] **Step 4: Verify the reproduced narrow window**

At exactly `760 × 1108`, open a PDF Export Preview and record live-surface evidence that:

1. Config and a recognizable PDF page are visible simultaneously.
2. Config scrolls independently without moving or hiding Preview.
3. Zoom out and zoom in resize the page and update the percentage.
4. Manual zoom survives a window resize.
5. Fit restores the whole page to the available canvas.

- [ ] **Step 5: Verify minimum and wide layouts**

At exactly `380 × 720`, prove that Config and a recognizable full PDF page are simultaneously present at the automatically calculated Fit percentage. Then enlarge beyond `lg` and prove the `300px` Config rail and Preview remain side by side.

- [ ] **Step 6: Review the final implementation diff**

```bash
git status --short
git diff HEAD~2..HEAD -- src/lib/exportPreviewZoom.ts src/lib/exportPreviewZoom.test.ts src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx
```

Expected: no debug artifacts, no zoom value in `ExportStyle`, no HTML zoom toolbar, no unrelated changes, and no missing accessibility labels.

## Task 5: Bump, synchronize, commit, and push the release

**Files:**
- Modify through Headatever: `VERSION`
- Modify through repository synchronization: `package.json`
- Modify through repository synchronization: `src-tauri/tauri.conf.json`
- Modify through repository synchronization: `src-tauri/Cargo.toml`
- Modify through repository synchronization: `Cargo.lock`

- [ ] **Step 1: Confirm release preconditions**

```bash
git status --short
git branch --show-current
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
```

Expected: working tree clean, branch `main`, and no remote-only commit. Stop rather than rebasing or force-pushing if `origin/main` is ahead.

- [ ] **Step 2: Preview and apply the Headatever patch bump without its standalone commit**

```bash
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --dry-run
/Users/channprj/.agents/skills/headatever/scripts/headatever.sh patch --no-git
```

Expected: the date advances to `260717` with patch `0` (or the same-day patch increments if another release already exists), and only `VERSION` changes at this point.

- [ ] **Step 3: Synchronize and verify every repository version surface**

```bash
pnpm sync-version
node scripts/sync-version.mjs --check
git diff -- VERSION package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
```

Expected: all five version surfaces contain exactly the new Headatever version and the check exits 0.

- [ ] **Step 4: Use the git-commit-push workflow for the release unit**

Inspect status, unstaged diff, staged diff, and recent commit conventions. Present this commit plan before committing:

```text
Plan: 1 commit

1. chore(release): bump version to the value in VERSION
   - VERSION
   - package.json
   - src-tauri/tauri.conf.json
   - src-tauri/Cargo.toml
   - Cargo.lock
```

Then create the commit with explicit paths only:

```bash
new_version=$(tr -d '[:space:]' < VERSION)
git add VERSION package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
git commit -m "chore(release): bump version to ${new_version}"
git status --short
git log --oneline -1
```

Expected: hook passes, working tree is clean, and the release commit is the new `HEAD`.

- [ ] **Step 5: Push without force and verify remote parity**

```bash
git push
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
node scripts/sync-version.mjs --check
git status --short
```

Expected: `main` and `origin/main` resolve to the same commit, version metadata remains synchronized, and the worktree is clean. If the push is rejected or fails, stop and report the exact error without retrying destructively.
