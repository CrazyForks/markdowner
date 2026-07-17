# Paginated PDF Preview and Paper Sizes Design

## Goal

Make Export Preview show the same page boundaries the native PDF exporter will
use, and expand PDF paper controls to A4, A3, A2, Letter, and custom millimetre
dimensions in portrait and landscape layouts.

The preview must remain live while the user changes export appearance or paper
settings. A misleading continuous document with decorative divider lines is not
acceptable: each visible preview sheet must clip the same paginated document at
the same coordinates as the exported PDF.

## Existing Behavior

Markdowner currently:

- stores one `paperSize` value with A4 and Letter as the only valid choices;
- renders one fixed-ratio PDF preview iframe;
- derives preview height from the selected A4 or Letter ratio;
- applies a Rust-owned JavaScript pagination routine inside the native WebKit
  exporter; and
- clips fixed-height WebKit regions into individual PDF pages.

The preview does not execute the native pagination routine, does not know the
page count, and cannot show where a block will move to the next page. Its single
sheet therefore cannot prove the exported pagination.

## Product Decisions

- Use a live stack of distinct page sheets, not a continuous document with
  divider overlays and not a regenerated native PDF viewer.
- Keep appearance Preset and PDF Paper controls independent.
- Offer A4, A3, A2, Letter, and Custom sizes. Letter remains available so the
  existing saved setting and export workflow do not regress.
- Use separate Size and Orientation controls for standard paper.
- Replace Orientation with Width, Height, and a swap action for Custom paper.
- Use millimetres for Custom dimensions.
- Keep preview-only zoom transient. Paper settings remain part of the persisted
  export style.
- Use one pagination implementation embedded in generated PDF HTML so preview
  and native export cannot silently drift to different algorithms.

## Paper Model

Extend `ExportStyle` with a flat, serializable paper model:

```ts
type PdfPaperPreset = 'A4' | 'A3' | 'A2' | 'Letter' | 'Custom';
type PdfPaperOrientation = 'portrait' | 'landscape';

interface ExportStyle {
  // Existing appearance fields...
  paperSize: PdfPaperPreset;
  paperOrientation: PdfPaperOrientation;
  paperWidthMm: number;
  paperHeightMm: number;
}
```

`paperWidthMm` and `paperHeightMm` retain the last valid Custom dimensions while
a standard preset is selected. This lets the user switch away from Custom and
return without losing the entered size.

Pure paper helpers own all physical-size calculations:

| Preset | Portrait width | Portrait height |
| --- | ---: | ---: |
| A4 | 210 mm | 297 mm |
| A3 | 297 mm | 420 mm |
| A2 | 420 mm | 594 mm |
| Letter | 215.9 mm | 279.4 mm |

Landscape swaps the standard preset's portrait dimensions. Custom dimensions
are already explicit, so Custom does not apply a second orientation transform.
The swap action exchanges its width and height values.

Custom width and height accept one decimal place in the range
`25.4–2000.0 mm`. Temporary input text may be empty or incomplete while the
field has focus. Invalid input displays an inline error and pauses preview
regeneration and Export; it is not silently clamped on blur.

All rendering dimensions use one conversion:

```text
points = millimetres × 72 / 25.4
```

The TypeScript preview and Rust exporter both operate on the same resolved
width and height in points.

## Persistence and Migration

Keep the current export-style storage key and normalize older saved objects:

- legacy `paperSize: "A4"` becomes A4 portrait;
- legacy `paperSize: "Letter"` becomes Letter portrait;
- missing orientation becomes portrait;
- missing Custom dimensions become `210 × 297 mm`;
- unknown presets, orientations, or non-finite dimensions fall back to the
  default paper values.

Appearance preset changes and Reset preserve all paper fields. Manual
appearance edits continue to set appearance Preset to Custom without changing
the PDF paper preset.

The app settings bridge currently remembers `pdfPaperSize` separately. Extend
that persisted settings contract with orientation and Custom dimensions so a
new Export Preview receives the complete last-used paper model. Existing
settings files migrate with the same portrait defaults.

## Config UI

The PDF-only Paper fieldset appears in the existing scrollable Config rail:

1. `Size` select: A4, A3, A2, Letter, Custom.
2. For standard sizes, a two-option `Portrait / Landscape` segmented control.
3. For Custom, labelled `Width` and `Height` number inputs with `mm` suffixes
   and a `Swap width and height` button.
4. A read-only output line with the resolved physical size.

Each standard option includes its portrait dimensions in the select label. The
resolved output reflects orientation, for example `420 × 297 mm` for A3
landscape.

Controls remain keyboard reachable and use explicit accessible names. The
orientation group exposes one pressed option, Custom validation is associated
with its input, and the swap button announces its full action rather than only
an icon.

HTML Export does not show Paper controls and keeps its responsive preview.

## Shared Pagination Contract

Generated PDF HTML owns the pagination algorithm. `buildExportHtml` embeds a
trusted, self-contained script only when `forPrint` is true. The script exposes
a namespaced Markdowner pagination entry point and automatically starts after:

- DOM load;
- `document.fonts.ready`, when supported; and
- all current document images have either loaded or failed.

The function:

1. resolves the `.markdowner-export` container;
2. applies the page margin/padding;
3. clears pagination offsets from any earlier run;
4. measures direct block children;
5. moves a block that would cross the usable page bottom to the next page's
   top margin when the block itself fits on one usable page;
6. leaves an oversized block in normal flow so it may span page clips;
7. measures final document height; and
8. returns total height and page count, capped at the shared 100-page maximum.

The generated HTML contains the resolved page width, height, margin, and a
unique preview token as data, not duplicated paper-name logic.

The old Rust-owned `PAGINATE_JS` algorithm is removed. Native export waits for
the generated document's pagination result and then clips the WebKit document
using the same page height. This makes the HTML result the authoritative
pagination source for both consumers.

## Paginated Preview Data Flow

1. `ExportPreviewTab` resolves the draft paper dimensions.
2. `buildExportHtml` returns self-contained PDF HTML with the shared paginator.
3. The first sandboxed preview iframe loads at the exact unscaled paper width
   and height in points.
4. The parent sends a page-index configuration message to the iframe. The
   iframe runs pagination, clips itself to page 1, and posts a token-scoped
   result containing page count and dimensions.
5. The component validates the message source, token, finite values, and
   1–100-page range before accepting it.
6. The component renders the remaining sheet frames. Each receives the same
   HTML and a different page index, runs the same pagination, translates the
   paginated content by `pageIndex × pageHeight`, and clips at one page.
7. Sheets appear in a vertical stack with a neutral canvas gap and
   `Page N / M` labels outside the exported content.

Preview iframes allow only the trusted generated script needed for pagination;
they do not receive same-origin privileges. User Markdown is still rendered
through the existing static React Markdown path rather than injected as
executable script.

Style, paper, request, image, or font changes create a new preview token.
Results from older tokens are ignored by the existing stale-result boundary.

## Zoom and Layout

The base preview sheet uses the resolved paper point dimensions instead of a
fixed `760px` width. Existing zoom behavior remains:

- Fit chooses the smaller width- and height-bound ratio for one whole sheet and
  never enlarges beyond 100%;
- all sheets receive one shared zoom scale;
- multiple sheets scroll vertically below the fitted first sheet;
- manual zoom remains `25–200%` in 10% steps;
- changing paper keeps the current zoom mode; and
- opening another Export Preview request resets to Fit.

The page gap stays a constant UI-space gap so it remains recognizable at small
Fit percentages. Sheet shadows, page labels, and canvas color are preview-only.

The previously approved narrow layout remains unchanged: Config and Preview
both stay visible, Config scrolls independently, and Preview owns the page-stack
scroll area.

## Native Export Contract

Replace the native `paper_size: String` payload with explicit validated
`paper_width_mm` and `paper_height_mm` values for single and batch exports.
Rust converts those values to points and rejects non-finite or out-of-range
dimensions before creating a WebKit frame.

The native exporter:

- loads the already configured PDF HTML;
- waits for the embedded paginator's ready result with the existing timeout
  discipline;
- verifies that the returned height and page count are finite and within the
  shared limit;
- creates one `WKPDFConfiguration` rectangle per page using the resolved point
  width and height; and
- merges the resulting pages as it does today.

The HTML `@page` rule uses explicit millimetre dimensions instead of a preset
name, so Custom and orientation are represented in the standalone document as
well.

## Loading, Errors, and Busy State

Until pagination completes, show the existing update progress state on the
sheet stack. Do not display unpaginated content as a finished preview.

Any of these conditions produce `Preview unavailable` and keep Export disabled:

- invalid Custom input;
- missing or malformed pagination result;
- zero/non-finite page dimensions;
- page count outside `1–100`; or
- preview iframe load failure.

Native failures continue to appear in the export error alert with the target
path. Busy mode disables appearance, paper, zoom, cancel, and export controls.

## Testing

### Pure TypeScript

- A4, A3, A2, and Letter portrait dimensions;
- landscape dimension swaps;
- Custom dimension and swap behavior;
- mm-to-point conversion;
- Custom validation boundaries and non-finite values;
- legacy storage migration and invalid-value fallback;
- appearance preset/Reset preserving the complete paper model;
- preview page size and Fit calculations for portrait, landscape, and Custom;
- pagination block movement, oversized blocks, page count, and rerun cleanup;
- explicit-dimension `@page` output; and
- single/batch desktop payloads carrying width and height.

### Component

- Paper controls appear only for PDF;
- standard Size and Orientation interactions update the live preview;
- Custom fields replace Orientation and expose accessible validation;
- invalid Custom input pauses preview and disables Export;
- swap exchanges Custom dimensions;
- page 1 result creates the correct number of labelled sheet frames;
- each frame receives the expected page index and clips at one sheet;
- stale or foreign postMessage results are ignored;
- Fit/manual zoom applies to every sheet;
- paper changes preserve zoom mode;
- request changes reset Fit; and
- current loading, preview-error, native-error, cancel, busy, appearance preset,
  and export behavior remains green.

### Rust

- valid mm-to-point conversion for all standard sizes and representative Custom
  dimensions;
- invalid, non-finite, too-small, and too-large dimensions;
- pagination-ready state, timeout, malformed result, and page cap;
- one clip rectangle per reported page with correct portrait/landscape media
  boxes; and
- existing PDF error formatting.

## Runtime Verification

Use a deterministic multi-page Markdown fixture with headings, paragraphs,
tables, code, and an image near page boundaries.

For A4, A3, and A2 in both portrait and landscape, plus one Custom size:

1. compare Preview page count with the exported PDF page count;
2. compare the last visible block on each preview sheet with the last block on
   the corresponding PDF page;
3. compare the first visible block on each following sheet;
4. verify the PDF media box matches the selected dimensions;
5. verify changing appearance or paper recomputes boundaries;
6. verify Fit and manual zoom across the full page stack;
7. verify the `380 × 720` minimum window and a wide window; and
8. verify HTML Export remains unchanged.

Completion gates:

- focused Vitest targets;
- full `pnpm test`;
- `pnpm exec tsc --noEmit --pretty false`;
- production frontend build;
- focused and full Rust tests;
- `git diff --check`; and
- real native PDF smoke evidence for every required preset/orientation class and
  Custom.

## Out of Scope

- a native PDF viewer or thumbnail sidebar;
- editing page breaks manually;
- headers, footers, bleed, crop marks, or printer profiles;
- persisting preview zoom;
- keyboard or trackpad zoom gestures;
- changing HTML Export layout; and
- promising byte-for-byte equivalence with external PDF engines. The contract
  is Markdowner's own WebKit exporter.
