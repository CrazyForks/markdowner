# Image Export and Export Terminology Design

## Summary

Markdowner will add `Export as Image…` for the current document and make every
export command use the same `Export as …` mental model. Image export will reuse
the existing self-contained HTML builder, export styling, paginated preview,
and native WebKit rendering pipeline.

Image export supports PNG, JPEG, and WebP. It opens in paginated mode by
default, can switch to one naturally continuous long image, and previews the
selected layout before writing any files.

## Goals

- Rename document export commands to `Export as HTML…` and `Export as PDF…`.
- Rename workspace commands to `Export All Markdown as HTML…` and
  `Export All Markdown as PDFs…`.
- Add `Export as Image…` to the File menu and command palette.
- Reuse the current Export Preview style and pagination controls.
- Export the current document as PNG, JPEG, or WebP.
- Support PDF-like page images and one uninterrupted long image.
- Keep preview and final native rendering aligned.
- Avoid partial file sets, silent overwrites, implicit scaling, and automatic
  layout fallbacks.

## Non-goals

- Image export does not operate on every Markdown file in a workspace.
- This work does not add SVG, TIFF, GIF, HEIC, or AVIF output.
- This work does not add transparent exports; the selected export background
  color is rendered into every output format.
- This work does not redesign the shared export appearance controls.
- This work does not change PDF pagination rules or HTML output semantics.
- This work does not bump the application version, create a release, or add a
  release tag.

## Terminology Contract

The File menu and command palette use these exact labels:

| Scope | Format | Label |
| --- | --- | --- |
| Current document | HTML | `Export as HTML…` |
| Current document | PDF | `Export as PDF…` |
| Current document | Image | `Export as Image…` |
| Workspace | HTML | `Export All Markdown as HTML…` |
| Workspace | PDF | `Export All Markdown as PDFs…` |

Tooltips and supporting text use “as” when describing a conversion and “to”
only when describing a destination path, such as “Exported PNG to …”. Existing
HTML and PDF command identifiers remain unchanged, and image export adds the
parallel `file.exportImage` identifier. The user-visible vocabulary is the
contract.

## Image Options

Image-only controls appear in the existing Export Preview Config rail:

- Format: PNG, JPEG, or WebP. PNG is the default.
- Layout: Pages or Long image. Pages is selected whenever a new image export
  preview opens.
- Resolution: 1×, 2×, or 3×. The default is 2×.
- Quality: 1–100 for JPEG and WebP, with a default of 90. PNG does not show a
  quality control because it is lossless.

The shared `ExportStyle` continues to own appearance, paper, content padding,
and page furniture. A separate `ImageExportOptions` value owns only image
format, layout, resolution scale, and lossy quality. Image options do not leak
into HTML or PDF settings.

Format, resolution, and quality use the dedicated versioned storage key
`markdowner.imageExportOptions.v1` so repeat exports do not discard those
preferences. Layout is not stored and deliberately resets to Pages on every
new request instead of restoring Long image, preserving the approved default.

## Preview Interaction

`Export as Image…` opens the same Export Preview tab used by HTML and PDF. The
header identifies the selected image format, and the primary action reads
`Export Image` while settings are editable and `Exporting…` while native output
is running.

### Pages

Pages mode uses the same paper size, orientation, content padding, page
furniture, pagination, page stack, Fit control, and manual zoom behavior as PDF
preview. Each visible preview sheet corresponds to exactly one final image.

The PDF-specific preview component is generalized to a paged-export component
instead of copying it for image export. It accepts an accessible format label
so iframe titles and announcements describe PDF or Image accurately.

### Long image

Long image mode renders one fixed-width continuous sheet:

- the selected paper size and orientation determine the canvas width;
- content padding and appearance controls remain active;
- paper height, page boundaries, page labels, page numbers, headers, and
  footers do not apply; and
- the preview measures and reports the actual continuous content height.

The document is not created by joining decorated PDF pages. Text, tables,
images, and code blocks remain in natural document flow from top to bottom.

Changing format, layout, scale, quality, style, paper width, source, or embedded
images invalidates stale preview measurements. Export remains disabled until
the active preview request is ready and its dimensions are valid.

## Rendering Model

The export HTML builder uses an explicit render mode rather than deriving three
contracts from one PDF boolean:

```ts
type ExportRenderMode = 'html' | 'paged' | 'continuous';
```

- `html` keeps the standalone HTML document responsive.
- `paged` embeds the existing pagination runtime and fixed paper geometry for
  PDF and paginated image output.
- `continuous` applies the selected paper width and export appearance without
  pagination or page furniture.

All modes continue to use the same React-Markdown rendering, code styling,
local and remote image embedding, heading hierarchy, and self-contained CSS.
User Markdown does not become executable script.

## Native WebKit Renderer

The macOS PDF exporter and new image exporter share a focused internal WebKit
render session responsible for:

1. constructing an offscreen `WKWebView` at validated dimensions;
2. loading the self-contained HTML;
3. waiting for navigation, fonts, embedded images, and stable layout;
4. evaluating numeric pagination or continuous-height probes with timeouts;
5. scrolling to a validated capture offset; and
6. taking a `WKSnapshotConfiguration` snapshot after screen updates.

PDF page creation remains on its current `WKPDFConfiguration` path. Extracting
the session must preserve PDF output behavior and error text unless a shared
message is intentionally made format-neutral.

For Pages image output, the renderer waits for the same pagination result as
PDF, scrolls to each paper-height offset, and captures one full paper viewport
at the requested output width. Resolution scale is defined against the
96-pixels-per-inch CSS paper size so output dimensions are deterministic:

```text
pixel width = paper width in CSS pixels × resolution scale
pixel height = paper height in CSS pixels × resolution scale
```

For Long image output, the renderer loads continuous HTML at the same resolved
paper width, measures the final content height, and captures bounded vertical
tiles. Tiles are decoded to a common RGBA representation and stitched without
page gaps or repeated furniture before the selected codec writes one file.

The codec layer writes lossless PNG and applies the selected quality to JPEG
and WebP. Before JPEG encoding, pixels are composited over the selected opaque
background. PNG and WebP receive the same visible background so all three
formats match preview.

## Data Flow

```text
File menu or command palette
  -> ExportPreviewRequest(format: image, scope: document)
  -> Export Preview style and image option editing
  -> save dialog returns one base path
  -> build self-contained paged or continuous HTML
  -> native image export command
  -> shared WebKit render session
  -> page snapshots or continuous tiles
  -> PNG, JPEG, or WebP encoder
  -> atomic output commit
  -> written path list returned to the app
  -> success announcement and preview tab close
```

The native command returns the actual paths it wrote. The frontend uses that
result for announcements instead of reconstructing names independently.

## File Naming and Atomicity

Long image output writes the exact path approved in the save dialog, such as
`Document.webp`.

Pages mode treats the chosen path as a base name and writes three-digit page
numbers in the same directory:

```text
Document-001.webp
Document-002.webp
Document-003.webp
```

The extension is normalized to the selected image format. The native exporter
computes the complete path set after pagination and rejects the operation if
any target already exists. It does not silently overwrite a previously
exported page set.

All output bytes are first written to uniquely named temporary files in the
destination directory. Final paths are committed only after every render and
encode operation succeeds. A failure removes temporary files and leaves
existing files untouched. Long image replacement uses the save
dialog's explicit overwrite approval and an atomic same-directory replacement.

## Limits and Validation

- Paginated output keeps the shared 100-page maximum.
- Format, layout, scale, quality, paper geometry, measured height, and page
  count are validated in TypeScript and again at the native boundary.
- Long image output has a 100,000,000-pixel maximum to bound memory and encode
  time.
- WebP width and height may not exceed 16,384 pixels. JPEG width and height may
  not exceed 65,535 pixels. PNG dimensions remain subject to the shared pixel
  budget and its 2,147,483,647-pixel axis limit.
- Invalid, zero, non-finite, or overflowed dimensions fail closed.
- The app never silently lowers resolution, changes format, or switches Long
  image to Pages.

When an output would exceed a limit, Export Preview stays open and shows an
actionable error instructing the user to lower the scale or use Pages. Native
validation repeats the same rule in case preview data is stale or bypassed.

## Errors and Busy State

Navigation failure, terminated WebKit content processes, asset timeouts,
malformed pagination results, snapshot failure, encoding failure, collisions,
and filesystem errors all identify the image destination and preserve the
preview for correction or retry.

Busy mode disables image controls, appearance controls, zoom, Cancel, and the
primary Export action. Cancel before native export closes the preview without
filesystem mutation. A native failure clears only temporary output and returns
control to the same preview state.

## Testing and Verification

### TypeScript model and HTML

- normalize PNG, JPEG, and WebP options and reject invalid values;
- reset every new image request to Pages while restoring only the saved format,
  scale, and quality preferences;
- generate `html`, `paged`, and `continuous` documents with the correct layout
  and furniture contract;
- keep the production/minified pagination runtime valid;
- calculate deterministic 1×, 2×, and 3× paper pixel sizes; and
- validate codec dimensions and total-pixel limits.

### UI

- remove all legacy `Export to HTML…` and `Export to PDF…` menu and command
  palette labels;
- expose `Export as Image…` only for an open current document;
- start in Pages and PNG at 2×;
- show quality only for JPEG and WebP;
- reuse the paged preview stack and page controls for PDF and Image Pages;
- hide page height and furniture in Long image while retaining paper width and
  content appearance;
- keep stale preview results from enabling Export; and
- show actionable size, collision, render, and encode errors.

### Rust

- validate image options and dimensions at the command boundary;
- derive exact three-digit page paths and normalized extensions;
- reject pre-existing page targets without mutation;
- verify PNG, JPEG, and WebP signatures and decoded dimensions;
- exercise quality handling and opaque background compositing;
- remove temporary files after injected render, encode, or commit failures;
- preserve existing PDF renderer tests; and
- cover timeout and malformed WebKit probe classification with pure helpers.

### Completion gates

- focused Vitest suites for export models, generated HTML, menus, command
  palette, Export Preview, paged preview, desktop commands, and App flow;
- full `pnpm test`;
- `pnpm exec tsc --noEmit --pretty false`;
- `pnpm exec vite build`;
- Rust formatting, clippy, and workspace tests;
- `git diff --check`; and
- explicit-path Conventional Commits, ordinary pushes, and final `0 0`
  local/upstream parity.

### Installed-app proof

Build and install the app, then use a fixture containing headings, paragraphs,
lists, tables, highlighted code, local images, and enough content for multiple
pages. Verify:

- paginated PNG, JPEG, and WebP produce the expected numbered file count;
- Long image produces one naturally continuous file in all three formats;
- file signatures and decoded pixel dimensions match the selected format,
  paper, and scale;
- the first, middle, and final page or long-image regions match Export Preview;
- no partial or overwritten files remain after a deliberate collision or
  failed export; and
- the installed application remains valid under deep, strict code-signing
  verification.

## Checkpoint Sequence

1. Commit and push this approved design document.
2. Rename every export surface and add the image option, preview, and pure
   rendering contracts with focused frontend coverage.
3. Add the shared native WebKit snapshot renderer, codecs, atomic file output,
   and Rust coverage.
4. Complete full and installed-app verification. If verification requires a
   correction, commit and push the smallest complete fix as another checkpoint.
