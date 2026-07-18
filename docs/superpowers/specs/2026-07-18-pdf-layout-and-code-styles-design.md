# PDF Layout, Page Furniture, and Code Style Design

## Goal

Extend Export Preview so PDF output can use uniform or independent top, right,
bottom, and left content padding; repeat optional header and footer text on
every page; add configurable page numbers; choose an export-specific fenced
code theme; and apply preset palettes to inline code.

The live paginated preview and the final native PDF must render the same
geometry, repeated text, page-number values, and code colors.

## Approved Product Decisions

- Content padding uses an explicit `All sides / Per side` mode selector.
- `All sides` keeps the current single-value range control. `Per side` replaces
  it with compact Top, Right, Bottom, and Left controls in a two-column grid.
- Header and footer text are optional. A non-empty value repeats on every PDF
  page.
- Header and footer alignment can be selected independently as Left, Center, or
  Right.
- Page numbers are optional and default to the bottom center when enabled.
- The default page-number format is `1/12`.
- Page-number format offers presets plus a custom template using `{page}` and
  `{pages}` tokens.
- Page-number placement supports the six header/footer slots: top or bottom,
  combined with left, center, or right.
- Fenced code defaults to `Match app theme`. A fixed export selection is saved
  independently from the application setting.
- Inline code uses the approved extended palette set: Match export theme,
  Neutral, Amber, Blue, Green, Rose, Contrast, and Custom. Each non-custom
  palette has readable light and dark variants.
- The existing 300 px settings rail remains the layout boundary. New controls
  use fieldsets and progressive disclosure rather than widening the rail.

## Considered Architectures

### 1. Extend the shared HTML paginator

The generated self-contained HTML remains authoritative. The paginator receives
per-side content insets and page-furniture settings, paginates content, then
creates one repeated decoration layer per page. Preview frames and the native
WebKit PDF exporter consume that same DOM.

This is the selected approach. It preserves the recently stabilized
`PdfPreviewPage` parent-side pagination path and keeps Preview and final PDF on
one implementation.

### 2. CSS paged-media margin boxes

Rules such as `@top-center` and `@bottom-center` would be compact, but WebKit
support and behavior vary across runtime versions. They would also be difficult
to validate in the parent-side paginated preview. This approach is rejected.

### 3. Native PDF post-processing

Rust/PDFKit could stamp text after WebKit creates each page. This would support
page numbers reliably in the artifact, but Preview would require a second
implementation and could drift. It also adds native text layout and font
handling for a feature that already fits the generated HTML contract. This
approach is rejected.

## Persisted Export Style

Keep the current `markdowner.exportStyle.v1` storage key and extend the
normalized `ExportStyle` object. Flat fields keep storage, React updates, and
legacy migration straightforward.

```ts
type ContentPaddingMode = 'all' | 'individual';
type PageTextAlignment = 'left' | 'center' | 'right';
type PageNumberPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';
type PageNumberFormat =
  | 'page-total'
  | 'page-total-spaced'
  | 'page-of-total'
  | 'page-only'
  | 'page-label'
  | 'page-label-of-total'
  | 'dash-page'
  | 'custom';
type ExportCodeBlockTheme = 'app' | CodeBlockTheme;
type InlineCodePreset =
  | 'theme'
  | 'neutral'
  | 'amber'
  | 'blue'
  | 'green'
  | 'rose'
  | 'contrast'
  | 'custom';

interface ExportStyle {
  // Existing palette, typography, table, keyboard-key, and paper fields.
  contentPaddingMode: ContentPaddingMode;
  contentPaddingTop: number;
  contentPaddingRight: number;
  contentPaddingBottom: number;
  contentPaddingLeft: number;

  headerText: string;
  headerAlignment: PageTextAlignment;
  footerText: string;
  footerAlignment: PageTextAlignment;

  pageNumbersEnabled: boolean;
  pageNumberPosition: PageNumberPosition;
  pageNumberFormat: PageNumberFormat;
  pageNumberTemplate: string;

  codeBlockTheme: ExportCodeBlockTheme;
  inlineCodePreset: InlineCodePreset;
  inlineCodeTextColor: string;
  inlineCodeBackgroundColor: string;
}
```

Defaults are 32 px on all sides, empty header/footer text, centered text
alignment, page numbers off, bottom-center placement, `page-total` format, the
`{page}/{pages}` custom template, `codeBlockTheme: 'app'`, and the current Amber
inline-code colors for backward visual compatibility.

All padding values use the existing `0–72 px` range. `All sides` stores equal
values in all four fields. Switching to `Per side` preserves those values;
switching back uses the current top value for all four sides so the resulting
state is explicit.

### Migration

- A legacy `contentPadding` scalar populates all four sides and selects
  `All sides`.
- Missing side fields fall back field-by-field to the legacy scalar, then to
  32 px.
- If a stored object has unequal side values but no valid mode, it migrates to
  `Per side`.
- Existing inline-code color pairs that match a built-in palette migrate to
  that preset. Any other valid pair migrates to `Custom`.
- Missing header, footer, page-number, and code-theme fields use the defaults.
- Unknown enums, invalid colors, non-finite padding, oversized text, and
  malformed templates normalize safely without preventing legacy exports from
  opening. A persisted invalid custom template falls back to
  `{page}/{pages}`; a temporarily invalid value being edited in the UI remains
  visible until the user corrects it.

Appearance Theme changes continue to update page/text/table palettes, but
preserve paper, padding, header/footer, page-number, code-theme, and inline-code
preset choices. This prevents a color-theme change from silently discarding
page layout work.

## Export Preview Controls

### Content padding

The existing `Content padding` control becomes a fieldset:

1. A two-option `All sides / Per side` segmented control.
2. `All sides` shows the existing range and numeric output.
3. `Per side` shows Top, Right, Bottom, and Left numeric/range controls in
   reading order.

The control remains available to HTML export because the shared export style
already applies content padding there. PDF additionally uses the values as
pagination geometry.

For PDF, the resolved left and right insets must leave positive page width, and
the effective top and bottom insets (including decoration bands) must leave
positive page height. A very small Custom paper combined with large padding
shows an inline geometry error, pauses preview regeneration, and disables
Export instead of silently clamping the user's values.

### PDF page furniture

Add a PDF-only `Header & footer` fieldset below Paper:

- `Header text (optional)` input and alignment select.
- `Footer text (optional)` input and alignment select.
- `Page numbers` switch.
- When enabled, Format and Position selects.
- When Format is Custom, show the template input and a small rendered example.

Preset formats are:

| Label | Template |
| --- | --- |
| `1/12` | `{page}/{pages}` |
| `1 / 12` | `{page} / {pages}` |
| `1 of 12` | `{page} of {pages}` |
| `1` | `{page}` |
| `Page 1` | `Page {page}` |
| `Page 1 of 12` | `Page {page} of {pages}` |
| `– 1 –` | `– {page} –` |

Custom templates are limited to 80 characters, must contain `{page}`, and may
contain `{pages}`. Unknown brace tokens are invalid. Invalid custom input stays
visible, shows an inline error, pauses preview regeneration, and disables
Export until corrected. Header/footer text is plain text, limited to 120
characters, and may be empty.

### Code styles

Add a `Code` fieldset:

- `Code block theme`: Match app theme plus the existing ten GitHub, One, Ayu,
  Flexoki, and Monokai light/dark themes.
- `Inline code`: Match export theme, Neutral, Amber, Blue, Green, Rose,
  Contrast, and Custom.
- Custom exposes the existing text/background color pickers. Built-in presets
  show a compact sample chip instead of two editable colors.

For non-custom inline presets, the light or dark pair is selected from the
resolved export background. Fixed Light/Dark and Match app export themes use
their known tone; Custom uses background-color luminance. Manual color editing
sets only the inline-code preset to Custom, while other Export Theme fields
retain their current state.

## Code Theme Resolution

The live document already exposes the resolved application code theme through
`data-cb-theme`, and the exported HTML already copies root attributes and the
bundled code-theme CSS.

`buildExportHtml` will:

1. preserve the live `data-cb-theme` when `codeBlockTheme === 'app'`;
2. replace that root attribute with a fixed selected theme otherwise; and
3. force `data-cb-highlight="on"` for the export document.

No syntax highlighter or palette CSS is duplicated. The existing lowlight DOM
and `styles.css` theme selectors remain the source of truth.

## Pagination and Repeated Page Furniture

Replace scalar `pageMargin` with a normalized per-side pagination contract:

```ts
interface PdfPageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface PdfPageFurniture {
  headerText: string;
  headerAlignment: PageTextAlignment;
  footerText: string;
  footerAlignment: PageTextAlignment;
  pageNumbersEnabled: boolean;
  pageNumberPosition: PageNumberPosition;
  pageNumberTemplate: string;
  textColor: string;
}
```

`paginatePdfDocument` performs these steps:

1. Remove decoration layers from an earlier run and restore original content
   block margins.
2. Compute top and bottom decoration bands. A band exists when it contains
   header/footer text or a page number. If two items target the same alignment
   slot, the slot stacks them and the band grows to two lines.
3. Set the export container's left/right padding from the selected values.
4. Use `top padding + top band + gap` and
   `bottom padding + bottom band + gap` as the usable content insets.
5. Move fitting content blocks across page boundaries using those asymmetric
   insets. Oversized blocks retain the existing spanning behavior.
6. Compute the final page count and enforce the existing 100-page limit.
7. Append one absolutely positioned, pointer-events-none decoration layer for
   each page inside `.markdowner-export`.
8. Fill each layer's three-column header and footer grids with plain
   `textContent`, replacing page-number tokens for that page.

The decoration layer sits inside the transformed export container. Therefore
`PdfPreviewPage`'s existing `translateY(-pageIndex * pageHeight)` clips the same
layer that native WebKit clips into the final PDF.

Each header/footer grid uses the selected left/right padding, a fixed compact
font size, the export font family, and a muted form of the export text color.
Long header/footer text remains one line and is ellipsized within its selected
third of the page. Page numbers do not wrap.

`buildPdfPaginationScript`, `PdfPreviewPage`, and their tests receive the same
inset and furniture object. Rust's native PDF command remains unchanged: it
continues waiting for the embedded pagination result and clipping exact
paper-sized regions.

## Preview and Export Data Flow

1. `App` combines the saved export style with remembered paper settings and
   passes the resolved application code theme to `ExportPreviewTab`.
2. Every valid draft change rebuilds the self-contained HTML.
3. `ExportPreviewTab` passes the draft page insets and furniture to every
   `PdfPreviewPage`.
4. The first page reports the trusted page count; all pages render the same
   generated DOM at different clip offsets.
5. Confirm normalizes and persists the full style before single or workspace
   export.
6. Final HTML embeds identical pagination configuration. Native WebKit waits
   for it, then clips and merges each page as it does today.

Workspace PDF exports reuse the same header/footer text and number format for
every file, with page counts restarting at 1 per document.

## Error Handling and Accessibility

- Header/footer and custom page-number values are inserted with `textContent`,
  never as HTML.
- Stale preview tokens, invalid paper geometry, invalid padding geometry,
  malformed custom templates, page overflow, and iframe failures keep Export
  disabled and use the existing error surface.
- Geometry validation is derived from the selected physical paper dimensions,
  four padding values, and computed decoration bands, so Preview and native
  export accept and reject the same page layout.
- All new inputs have visible labels and accessible names.
- Segmented controls expose one pressed value.
- Disabled/hidden dependent controls are removed from keyboard order.
- Page-number examples are outputs with polite live updates.
- Busy mode disables padding, page-furniture, code-theme, and inline-preset
  controls along with existing actions.

## Testing

### Export style and HTML

- Legacy scalar padding migration and four-side normalization.
- All-sides/per-side transitions and range clamping.
- Defaults and invalid-enum fallback for every new field.
- Header/footer length normalization and page-template validation.
- Page-number preset rendering and custom token replacement.
- Inline preset light/dark pairs, Custom preservation, and background-luminance
  tone selection.
- Fixed and Match app code-theme root attributes.
- Storage round trip for the complete style.
- HTML padding output uses four values.

### Pagination

- Asymmetric top/bottom usable bounds.
- Independent left/right container padding.
- A block crossing an asymmetric usable bottom moves to the next page's
  asymmetric usable top.
- Rerunning removes old decorations and restores content margins.
- Header/footer repeat for every computed page.
- All six page-number positions and page-specific values.
- Same-slot text/number stacking.
- Plain-text escaping, long-text behavior, oversized blocks, and the page cap.
- Embedded runtime serialization includes the exact insets and furniture.

### Export Preview

- All sides and Per side controls switch without losing values.
- Per-side edits update preview and confirmed style.
- Header/footer inputs and independent alignment controls are PDF-only.
- Page numbers default to bottom-center `1/12`.
- Preset and Custom formats update the live preview.
- Invalid Custom pauses regeneration and disables Export.
- Code block theme lists Match app plus all ten existing themes.
- Inline code lists the approved extended presets and shows Custom color inputs
  only when needed.
- Preview iframe receives fixed code-theme attributes and inline colors.
- Request/theme changes, Reset, busy, stale results, errors, page labels, zoom,
  and paper controls retain current behavior.

### Application and Runtime

- Confirmation persists new style fields and uses them for document and
  workspace PDF generation.
- HTML export retains four-side padding and code styles but omits PDF page
  furniture.
- Full focused and repository test suites, TypeScript check, production build,
  Rust tests, and `git diff --check`.
- Install the app and use a deterministic multi-page fixture containing
  headings, prose, inline code, fenced code, a table, and an image.
- Verify uniform and asymmetric padding, header/footer repetition, at least
  three page-number formats and positions, two fixed code themes, all inline
  preset families across light/dark export themes, Preview/final PDF page-count
  parity, and exact PDF media boxes.

## Non-Goals

- Rich-text or HTML headers and footers.
- Per-page or first-page-only header/footer rules.
- Arbitrary fonts, font sizes, or colors for page furniture.
- PDF post-processing, watermarks, or background images.
- Different settings per file inside one workspace batch.
