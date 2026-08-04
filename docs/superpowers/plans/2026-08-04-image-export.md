# Image Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add previewed PNG, JPEG, and WebP export for the current document in paginated and continuous layouts while changing every export command to the `Export as …` vocabulary.

**Architecture:** Extend the existing self-contained export HTML and Export Preview contracts, then add a shared offscreen WebKit render session used by PDF and image output. Paginated image export captures the same pages as PDF; continuous export captures bounded WebKit tiles and stitches them before encoding and atomically committing the selected files.

**Tech Stack:** React 19, TypeScript 5.8, Vitest 4, Tauri 2, Rust 2024, macOS WebKit/AppKit through objc2 0.6/0.3, image 0.25.10, webpx 0.4.0.

## Global Constraints

- Exact document labels are `Export as HTML…`, `Export as PDF…`, and `Export as Image…`.
- Exact workspace labels are `Export All Markdown as HTML…` and `Export All Markdown as PDFs…`.
- Image export targets only the current document.
- Formats are PNG, JPEG, and WebP; defaults are PNG, Pages, 2×, and quality 90.
- Every new image preview resets layout to Pages; only format, scale, and quality persist under `markdowner.imageExportOptions.v1`.
- Page files use `Document-001.ext`, `Document-002.ext`, and so on in the selected folder.
- Long image output has no page breaks, repeated furniture, or page labels.
- Paginated export allows at most 100 pages; Long image allows at most 100,000,000 pixels.
- WebP axes are at most 16,383 pixels; JPEG axes are at most 65,535 pixels.
- Never overwrite an existing paginated target; never leave partial page sets or temporary files.
- Do not add workspace image export, transparent output, a version bump, a release, or a tag.
- Execute inline in the main thread because repository `AGENTS.md` maps subagent work to sequential main-thread execution.
- Use explicit-path staging, Conventional Commits, an ordinary push after each checkpoint, and prove `HEAD...@{u}` is `0 0` before continuing.

---

## File Structure

### New frontend files

- `src/lib/imageExport.ts` — image options, storage, pixel geometry, codec limits, and labels.
- `src/lib/imageExport.test.ts` — pure image option and dimension coverage.
- `src/lib/exportPreviewFrame.ts` — shared iframe asset/layout readiness helpers.
- `src/shell/ImageExportControls.tsx` — format, layout, scale, and quality controls.
- `src/shell/ImageExportControls.test.tsx` — accessible image control behavior.
- `src/shell/PagedExportPreviewPage.tsx` — generalized PDF/Image page iframe.
- `src/shell/PagedExportPreviewPage.test.tsx` — format-aware page readiness and failure tests.
- `src/shell/ContinuousExportPreview.tsx` — fixed-width continuous iframe and measured-height callback.
- `src/shell/ContinuousExportPreview.test.tsx` — continuous sizing and stale-result tests.

### New native files

- `src-tauri/src/web_export.rs` — macOS WebKit load, probe, PDF page, and snapshot session.
- `src-tauri/src/image_export.rs` — option validation, page naming, snapshot composition, codecs, and atomic commit.

### Existing files to modify

- `src/lib/exportDocument.ts` and `.test.ts` — add Image format and explicit HTML render modes.
- `src/lib/exportPreviewZoom.ts` and `.test.ts` — deterministic output pixel size and width-fit continuous zoom.
- `src/lib/desktop.ts` and `.test.ts` — typed `write_image_file` bridge.
- `src/shell/PdfPaperControls.tsx` and `.test.tsx` — page versus canvas-width presentation.
- `src/shell/ExportPreviewTab.tsx` and `.test.tsx` — image option state and paged/continuous preview composition.
- `src/shell/AppMenu.tsx` and `.test.tsx` — terminology and current-document image action.
- `src/shell/commandPaletteCommands.ts` and `.test.ts` — terminology and `file.exportImage`.
- `src/App.tsx` and `src/App.test.tsx` — open, confirm, persist, save, invoke, announce, and error flow.
- `src-tauri/src/pdf_export.rs` — delegate WebKit session mechanics without changing PDF behavior.
- `src-tauri/src/lib.rs` — deserialize and register `write_image_file`.
- `src-tauri/Cargo.toml` and `Cargo.lock` — image, WebP, AppKit, and WebKit snapshot dependencies/features.

---

### Task 1: Align Every Export Label

**Files:**
- Modify: `src/shell/AppMenu.tsx`
- Modify: `src/shell/AppMenu.test.tsx`
- Modify: `src/shell/commandPaletteCommands.ts`
- Modify: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/App.test.tsx`
- Modify: `src/lib/exportDocument.ts`

**Interfaces:**
- Consumes: existing `onExportHtml`, `onExportPdf`, `exportHtml`, `exportPdf`, and workspace callbacks.
- Produces: exact user-visible `Export as …` labels without changing existing callback or command IDs.

- [ ] **Step 1: Change focused assertions to the approved vocabulary**

```ts
expect(screen.getByRole('menuitem', { name: 'Export as HTML…' })).toBeEnabled();
expect(screen.getByRole('menuitem', { name: 'Export as PDF…' })).toBeEnabled();
expect(commands.find((command) => command.id === 'file.exportWorkspaceHtml')?.label)
  .toBe('Export All Markdown as HTML…');
expect(commands.find((command) => command.id === 'file.exportWorkspacePdfs')?.label)
  .toBe('Export All Markdown as PDFs…');
```

- [ ] **Step 2: Run focused tests and confirm the old labels fail**

Run:

```bash
pnpm exec vitest run src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.test.ts src/App.test.tsx --reporter=verbose
```

Expected: FAIL because production UI still contains `Export to …`.

- [ ] **Step 3: Update menu, command-palette, test selectors, and export comments**

```tsx
<MenuAction title="Export the document as a styled HTML file">Export as HTML…</MenuAction>
<MenuAction title="Export the document as a PDF file">Export as PDF…</MenuAction>
<MenuAction title="Export all Markdown files in the workspace as HTML">Export All Markdown as HTML…</MenuAction>
<MenuAction title="Export all Markdown files in the workspace as PDFs">Export All Markdown as PDFs…</MenuAction>
```

Update `buildExportHtml` documentation to say it serves `Export as HTML` and `Export as PDF`.

- [ ] **Step 4: Verify labels and absence of legacy copy**

Run:

```bash
pnpm exec vitest run src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.test.ts src/App.test.tsx --reporter=verbose
rg -n "Export to (HTML|PDF|Image)|Export All Markdown to" src --glob '!**/*.snap'
git diff --check
```

Expected: tests PASS and `rg` returns no user-facing legacy label.

- [ ] **Step 5: Commit and push checkpoint**

```bash
git add src/shell/AppMenu.tsx src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.ts src/shell/commandPaletteCommands.test.ts src/App.test.tsx src/lib/exportDocument.ts
git commit -m "fix(ui): align export terminology"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected: parity `0 0`.

---

### Task 2: Add Image Options and Explicit Render Modes

**Files:**
- Create: `src/lib/imageExport.ts`
- Create: `src/lib/imageExport.test.ts`
- Modify: `src/lib/exportDocument.ts`
- Modify: `src/lib/exportDocument.test.ts`
- Modify: `src/lib/exportPreviewZoom.ts`
- Modify: `src/lib/exportPreviewZoom.test.ts`

**Interfaces:**
- Produces: `ImageExportFormat`, `ImageExportLayout`, `ImageExportScale`, `ImageExportOptions`, `DEFAULT_IMAGE_EXPORT_OPTIONS`, `loadImageExportOptions`, `saveImageExportPreferences`, `validateImageOutputSize`, and `imageExtension`.
- Produces: `ExportRenderMode = 'html' | 'paged' | 'continuous'` accepted by `buildExportHtml`.
- Consumes: `ResolvedPdfPaper`, `MAX_PDF_PAGES`, `ExportStyle`, and existing storage conventions.

- [ ] **Step 1: Write failing model tests**

```ts
const storage = {
  getItem: () => JSON.stringify({ format: 'webp', scale: 3, quality: 84, layout: 'long' }),
  setItem: vi.fn(),
};
expect(loadImageExportOptions(storage)).toEqual({
  format: 'webp',
  layout: 'pages',
  scale: 3,
  quality: 84,
});
expect(imageExtension('jpeg')).toBe('jpg');
expect(validateImageOutputSize({ format: 'webp', width: 16_384, height: 200, pages: 1 })).toEqual({
  valid: false,
  message: 'WebP images cannot exceed 16383 pixels on either side. Lower the scale or use Pages.',
});
```

Add HTML tests asserting:

```ts
expect(await buildExportHtml({ ...input, renderMode: 'paged' })).toContain('__markdownerPdfPaginationStatus');
expect(await buildExportHtml({ ...input, renderMode: 'continuous' })).not.toContain('__markdownerPdfPaginationStatus');
expect(await buildExportHtml({ ...input, renderMode: 'continuous' })).toContain('data-export-layout="continuous"');
```

- [ ] **Step 2: Run the pure suites and observe missing contracts**

```bash
pnpm exec vitest run src/lib/imageExport.test.ts src/lib/exportDocument.test.ts src/lib/exportPreviewZoom.test.ts --reporter=verbose
```

Expected: FAIL because image types, storage, limits, and render modes do not exist.

- [ ] **Step 3: Implement the exact image model**

```ts
export type ImageExportFormat = 'png' | 'jpeg' | 'webp';
export type ImageExportLayout = 'pages' | 'long';
export type ImageExportScale = 1 | 2 | 3;

export interface ImageExportOptions {
  format: ImageExportFormat;
  layout: ImageExportLayout;
  scale: ImageExportScale;
  quality: number;
}

export const DEFAULT_IMAGE_EXPORT_OPTIONS: ImageExportOptions = {
  format: 'png', layout: 'pages', scale: 2, quality: 90,
};
```

Use `markdowner.imageExportOptions.v1`; store only `format`, `scale`, and `quality`; normalize malformed stored data to defaults; always return `layout: 'pages'` from `loadImageExportOptions`.

- [ ] **Step 4: Replace `forPrint` with a render-mode contract**

```ts
export type ExportFormat = 'html' | 'pdf' | 'image';
export type WorkspaceExportFormat = Exclude<ExportFormat, 'image'>;
export type ExportRenderMode = 'html' | 'paged' | 'continuous';

export interface ExportHtmlOptions {
  // existing fields
  renderMode?: ExportRenderMode;
}
```

Use paginated CSS/script only for `paged`, responsive max-width only for `html`, and fixed-width/no-furniture CSS marked `data-export-layout="continuous"` for `continuous`. Type workspace target building as `WorkspaceExportFormat` so image cannot enter the batch path.

- [ ] **Step 5: Add deterministic image geometry helpers**

```ts
export const CSS_PIXELS_PER_INCH = 96;
export function imagePagePixelSize(paper: ResolvedPdfPaper, scale: ImageExportScale) {
  return {
    width: Math.round((paper.widthMm / 25.4) * CSS_PIXELS_PER_INCH * scale),
    height: Math.round((paper.heightMm / 25.4) * CSS_PIXELS_PER_INCH * scale),
  };
}
```

Validate finite positive integers, page count `1..100`, the 100,000,000-pixel Long budget, WebP 16,383-axis limit, JPEG 65,535-axis limit, and PNG's format axis limit.

- [ ] **Step 6: Run the pure suites, typecheck, and diff check**

```bash
pnpm exec vitest run src/lib/imageExport.test.ts src/lib/exportDocument.test.ts src/lib/exportPreviewZoom.test.ts --reporter=verbose
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: all PASS.

---

### Task 3: Generalize Export Preview for Pages and Long Image

**Files:**
- Create: `src/lib/exportPreviewFrame.ts`
- Create: `src/shell/ImageExportControls.tsx`
- Create: `src/shell/ImageExportControls.test.tsx`
- Create: `src/shell/PagedExportPreviewPage.tsx`
- Create: `src/shell/PagedExportPreviewPage.test.tsx`
- Create: `src/shell/ContinuousExportPreview.tsx`
- Create: `src/shell/ContinuousExportPreview.test.tsx`
- Delete: `src/shell/PdfPreviewPage.tsx`
- Delete: `src/shell/PdfPreviewPage.test.tsx`
- Modify: `src/shell/PdfPaperControls.tsx`
- Modify: `src/shell/PdfPaperControls.test.tsx`
- Modify: `src/shell/ExportPreviewTab.tsx`
- Modify: `src/shell/ExportPreviewTab.test.tsx`

**Interfaces:**
- Consumes: Task 2 image option and render-mode types.
- Produces: `PagedExportPreviewPage` with `formatLabel`, `ContinuousExportPreview` with `onReady({ width, height })`, and `ExportPreviewTab.onConfirm(style, imageOptions)`.

- [ ] **Step 1: Write failing accessible-control and preview tests**

```tsx
renderPreview({ request: IMAGE_REQUEST, initialImageOptions: DEFAULT_IMAGE_EXPORT_OPTIONS });
expect(screen.getByRole('combobox', { name: 'Image format' })).toHaveValue('png');
expect(screen.getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-pressed', 'true');
expect(screen.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true');
expect(screen.queryByRole('slider', { name: 'Image quality' })).not.toBeInTheDocument();
```

Switch to JPEG and assert quality appears. Switch to Long image and assert page furniture/page captions disappear, `Canvas width` remains, and continuous ready dimensions enable `Export Image`.

- [ ] **Step 2: Run preview suites and confirm missing image UI**

```bash
pnpm exec vitest run src/shell/ImageExportControls.test.tsx src/shell/PagedExportPreviewPage.test.tsx src/shell/ContinuousExportPreview.test.tsx src/shell/PdfPaperControls.test.tsx src/shell/ExportPreviewTab.test.tsx --reporter=verbose
```

Expected: FAIL because the new components and props are absent.

- [ ] **Step 3: Extract shared iframe readiness and generalize the page component**

```ts
export async function waitForExportPreviewAssets(doc: Document): Promise<void>;
export async function waitForExportPreviewLayout(frame: HTMLIFrameElement, doc: Document): Promise<void>;
```

Move the existing font/image/frame checks without behavior changes. Rename `PdfPreviewPage` to `PagedExportPreviewPage`; add `formatLabel: 'PDF' | 'Image'`; title the iframe `${formatLabel} preview page ${pageIndex + 1}`.

- [ ] **Step 4: Implement isolated image controls**

```tsx
<select aria-label="Image format" value={value.format}>…</select>
<div role="group" aria-label="Image layout">…Pages…Long image…</div>
<div role="group" aria-label="Image resolution">…1×…2×…3×…</div>
{value.format === 'png' ? null : <input type="range" aria-label="Image quality" min={1} max={100} />}
```

Every change emits a normalized complete `ImageExportOptions` object.

- [ ] **Step 5: Implement continuous preview and paper-width UI**

`ContinuousExportPreview` loads the trusted self-contained HTML in a same-origin sandbox, waits for assets/layout, measures `.markdowner-export` with finite positive width/height, and ignores callbacks from replaced iframe documents.

Add `mode="page" | "canvas-width"` to `PdfPaperControls`. Canvas-width mode keeps preset/orientation and Custom width, labels the resolved output `Canvas width`, and omits page-height validation and output.

- [ ] **Step 6: Compose formats in ExportPreviewTab**

```ts
const isImage = request.format === 'image';
const isPaged = request.format === 'pdf' || (isImage && imageOptions.layout === 'pages');
const renderMode: ExportRenderMode = isPaged ? 'paged' : isImage ? 'continuous' : 'html';
```

Reset image layout to Pages when request identity changes. Header format is `PNG`, `JPEG`, or `WEBP`; primary action is `Export Image`. Validate measured output size before enabling export. Keep PDF and HTML behavior unchanged.

- [ ] **Step 7: Run focused UI, full type, and build checks**

```bash
pnpm exec vitest run src/shell/ImageExportControls.test.tsx src/shell/PagedExportPreviewPage.test.tsx src/shell/ContinuousExportPreview.test.tsx src/shell/PdfPaperControls.test.tsx src/shell/ExportPreviewTab.test.tsx --reporter=verbose
pnpm exec tsc --noEmit --pretty false
pnpm exec vite build
git diff --check
```

Expected: all PASS.

- [ ] **Step 8: Commit and push the frontend preview checkpoint**

```bash
git add src/lib/imageExport.ts src/lib/imageExport.test.ts src/lib/exportDocument.ts src/lib/exportDocument.test.ts src/lib/exportPreviewZoom.ts src/lib/exportPreviewZoom.test.ts src/lib/exportPreviewFrame.ts src/shell/ImageExportControls.tsx src/shell/ImageExportControls.test.tsx src/shell/PagedExportPreviewPage.tsx src/shell/PagedExportPreviewPage.test.tsx src/shell/ContinuousExportPreview.tsx src/shell/ContinuousExportPreview.test.tsx src/shell/PdfPreviewPage.tsx src/shell/PdfPreviewPage.test.tsx src/shell/PdfPaperControls.tsx src/shell/PdfPaperControls.test.tsx src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx
git commit -m "feat(export): add image export preview"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected: parity `0 0`.

---

### Task 4: Add the Native WebKit Image Renderer

**Files:**
- Create: `src-tauri/src/web_export.rs`
- Create: `src-tauri/src/image_export.rs`
- Modify: `src-tauri/src/pdf_export.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `Cargo.lock`

**Interfaces:**
- Produces: `image_export::write_image_file(request: &ImageExportRequest) -> Result<ImageExportResult, String>`.
- Produces: `web_export::WebExportSession::{load, eval_number, wait_for_number, create_pdf, snapshot_rgba, scroll_to}` on macOS.
- Consumes: self-contained paged/continuous HTML and explicit paper/image options.

- [ ] **Step 1: Add failing pure native tests**

```rust
assert_eq!(page_output_paths(Path::new("/tmp/Guide.webp"), ImageFormat::Webp, 2)?, vec![
    PathBuf::from("/tmp/Guide-001.webp"),
    PathBuf::from("/tmp/Guide-002.webp"),
]);
assert!(validate_dimensions(ImageFormat::Webp, 16_385, 200, ImageLayout::Long).is_err());
assert!(encode_rgba(ImageFormat::Png, 90, 1, 1, &[255, 0, 0, 255])?.starts_with(b"\x89PNG"));
```

Add injected-write tests proving a second-page failure removes temporary and already-committed new outputs while preserving pre-existing files.

- [ ] **Step 2: Run native tests and confirm modules are missing**

```bash
cargo test -p markdowner-desktop image_export -- --nocapture
```

Expected: FAIL because `image_export` and its helpers do not exist.

- [ ] **Step 3: Add pinned codec and snapshot features**

```toml
image = { version = "0.25.10", default-features = false, features = ["jpeg", "png", "tiff"] }
tempfile = "3"
webpx = { version = "0.4.0", default-features = false, features = ["encode", "std"] }
```

Move the existing test-only `tempfile` declaration into normal dependencies. Enable `NSImage` and `NSBitmapImageRep` in `objc2-app-kit`, and `WKSnapshotConfiguration` in `objc2-web-kit`. Regenerate `Cargo.lock` with `cargo check -p markdowner-desktop` rather than editing it manually.

- [ ] **Step 4: Extract the shared WebKit session without changing PDF behavior**

Move navigation delegate ownership, run-loop pumping, load timeout, numeric JS evaluation, and PDF capture into `web_export.rs`. Keep the existing 10-second load/JS and 20-second render timeout values. Store the retained navigation delegate inside the session so it cannot deallocate during export.

```rust
pub(crate) struct WebExportSession {
    webview: Retained<WKWebView>,
    _navigation_delegate: Retained<ExportNavigationDelegate>,
}
```

`snapshot_rgba` configures a bounds-contained `WKSnapshotConfiguration`, sets the requested snapshot width, converts `NSImage::TIFFRepresentation()` through `image` to RGBA, and normalizes the decoded bitmap to the exact expected pixel dimensions.

- [ ] **Step 5: Implement page and continuous capture**

Pages waits for `__markdownerPdfPaginationResult`, validates `1..=100`, scrolls to `index × paperHeight`, captures the page, and encodes to temporary files.

Long image probes `.markdowner-export` height, validates the final pixel geometry, captures viewport-height tiles, and handles the final overlapping scroll region with:

```rust
let scroll_top = tile_start.min(total_height.saturating_sub(viewport_height));
let source_y = tile_start - scroll_top;
let copy_height = (viewport_height - source_y).min(total_height - tile_start);
```

Copy only `source_y..source_y + copy_height` into the final RGBA buffer so the output contains no duplicated seam.

- [ ] **Step 6: Implement codecs and atomic output**

Use `PngEncoder` for RGBA, `JpegEncoder::new_with_quality` for opaque RGB, and `webpx::EncoderConfig::new().quality(quality as f32).encode_rgba` for WebP. Preflight all page targets with `try_exists()`. Write `NamedTempFile`s in the destination, persist page files with no-clobber semantics, and remove every newly persisted page if a later commit fails.

- [ ] **Step 7: Re-run native and PDF regression gates**

```bash
cargo fmt --all -- --check
cargo clippy -p markdowner-desktop --all-targets -- -D warnings
cargo test -p markdowner-desktop image_export -- --nocapture
cargo test -p markdowner-desktop pdf_export -- --nocapture
cargo test --workspace
git diff --check
```

Expected: all PASS and existing PDF tests remain unchanged or stronger.

- [ ] **Step 8: Commit and push the native renderer checkpoint**

```bash
git add src-tauri/src/web_export.rs src-tauri/src/image_export.rs src-tauri/src/pdf_export.rs src-tauri/Cargo.toml Cargo.lock
git commit -m "feat(export): add native image renderer"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected: parity `0 0`.

---

### Task 5: Wire the Current-Document Image Export Flow

**Files:**
- Modify: `src/lib/desktop.ts`
- Modify: `src/lib/desktop.test.ts`
- Modify: `src/shell/AppMenu.tsx`
- Modify: `src/shell/AppMenu.test.tsx`
- Modify: `src/shell/commandPaletteCommands.ts`
- Modify: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `ImageExportOptions`, `buildExportHtml(renderMode)`, and `image_export::write_image_file`.
- Produces: `exportImageFile(request): Promise<ImageExportResult>`, `onExportImage`, `file.exportImage`, and the complete save/export/announce flow.

- [ ] **Step 1: Write failing bridge and App-flow tests**

```ts
await exportImageFile({
  path: '/tmp/Guide.webp', html: '<html />', format: 'webp', layout: 'pages',
  scale: 2, quality: 90, paperWidthMm: 210, paperHeightMm: 297,
  backgroundColor: '#ffffff',
});
expect(invokeMock).toHaveBeenCalledWith('write_image_file', { request: expect.objectContaining({ format: 'webp' }) });
```

App tests must open `Export as Image…`, observe Pages/PNG/2× defaults, switch to Long image/WebP, confirm, assert the save filter and continuous HTML, assert the native request, and assert the success announcement uses returned paths. Add rejection coverage that leaves Export Preview open with the native error.

- [ ] **Step 2: Run focused suites and confirm missing integration**

```bash
pnpm exec vitest run src/lib/desktop.test.ts src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.test.ts src/App.test.tsx --reporter=verbose
```

Expected: FAIL because the image action, bridge, and command are absent.

- [ ] **Step 3: Add the typed desktop and Tauri command boundary**

```ts
export interface ImageExportRequest {
  path: string;
  html: string;
  format: ImageExportFormat;
  layout: ImageExportLayout;
  scale: ImageExportScale;
  quality: number;
  paperWidthMm: number;
  paperHeightMm: number;
  backgroundColor: string;
}
export interface ImageExportResult { paths: string[] }
```

Deserialize the same camelCase request in Rust, call `image_export::write_image_file`, return camelCase `paths`, register `write_image_file`, and add `mod image_export; mod web_export;`.

- [ ] **Step 4: Add menu and command-palette image actions**

Add `onExportImage` after PDF in the menu and `exportImage` after `exportPdf` in palette actions. Add `file.exportImage` after `file.exportPdf`, disabled without an open document. Use the exact `Export as Image…` label and an image/file icon distinct from PDF.

- [ ] **Step 5: Branch App confirmation by format**

For Image, choose a save path with the selected extension/filter, call `buildExportHtml` with `paged` or `continuous`, invoke `exportImageFile`, persist format/scale/quality, announce the returned file count/location, and close preview only on success. Do not add Image to `openWorkspaceExport`.

- [ ] **Step 6: Run focused integration, type, build, and Rust gates**

```bash
pnpm exec vitest run src/lib/desktop.test.ts src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.test.ts src/shell/ExportPreviewTab.test.tsx src/App.test.tsx --reporter=verbose
pnpm exec tsc --noEmit --pretty false
pnpm exec vite build
cargo fmt --all -- --check
cargo clippy -p markdowner-desktop --all-targets -- -D warnings
cargo test -p markdowner-desktop --lib
rg -n "Export to (HTML|PDF|Image)|Export All Markdown to" src --glob '!**/*.snap'
git diff --check
```

Expected: all tests/builds PASS and the legacy-label search returns no matches.

- [ ] **Step 7: Commit and push the complete workflow**

```bash
git add src/lib/desktop.ts src/lib/desktop.test.ts src/shell/AppMenu.tsx src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.ts src/shell/commandPaletteCommands.test.ts src/App.tsx src/App.test.tsx src-tauri/src/lib.rs
git commit -m "feat(export): wire image export workflow"
git push
git rev-list --left-right --count HEAD...@{u}
```

Expected: parity `0 0`.

---

### Task 6: Full and Installed-App Verification

**Files:**
- Create temporarily outside Git: a Markdown fixture and export directory under `$(mktemp -d)`.
- Modify only if evidence reveals a defect: the smallest source/test files responsible for that defect.

**Interfaces:**
- Consumes: the complete image export workflow.
- Produces: requirement-by-requirement source, test, artifact, runtime, and remote evidence.

- [ ] **Step 1: Run repository-wide automated gates**

```bash
pnpm test
pnpm exec tsc --noEmit --pretty false
pnpm exec vite build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm sync-version -- --check
git diff --check
```

Expected: all PASS.

- [ ] **Step 2: Build, install, and open the real application**

```bash
pnpm build:install:open
codesign --verify --deep --strict /Applications/Markdowner.app
```

Expected: the app launches and deep/strict code-sign verification succeeds.

- [ ] **Step 3: Exercise all six image outcomes**

Use one saved Markdown fixture containing H1–H4, paragraphs, lists, a table, highlighted code, a local image, and at least three A4 pages. Through the installed UI export:

```text
Pages: PNG, JPEG, WebP
Long image: PNG, JPEG, WebP
```

Verify menu copy, live preview, Pages default, page count, continuous layout, format/scale/quality controls, collision error, and retained preview after failure.

- [ ] **Step 4: Inspect real artifacts**

Create the QA root before launching the app and choose paths beneath it in the
save dialog:

```bash
image_export_qa_dir=$(mktemp -d /tmp/markdowner-image-export.XXXXXX)
mkdir "$image_export_qa_dir/exports"
file "$image_export_qa_dir"/exports/*
sips -g pixelWidth -g pixelHeight -g format "$image_export_qa_dir"/exports/*
```

Expected: numbered page files, one long file per Long export, correct signatures, deterministic dimensions, no page seams in long output, no partial files, and no overwritten collision target.

- [ ] **Step 5: Route any failure back to an exact implementation task**

If verification reveals a defect, stop the completion audit, add a concrete
red/green step under the responsible task naming the exact source and test
paths, and publish the verified correction through the realtime workflow. Do
not manufacture a correction commit when all evidence passes.

- [ ] **Step 6: Complete the requirement and remote audit**

```bash
git status --short --branch
git log --oneline ad5a0e7..HEAD
git rev-list --left-right --count HEAD...@{u}
git ls-remote origin refs/heads/main
```

Expected: clean worktree, every requested outcome proven, local/upstream `0 0`, and live `refs/heads/main` at local HEAD.
