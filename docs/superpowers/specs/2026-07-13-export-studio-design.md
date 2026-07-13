# Export Studio Design

## Goal

Replace direct HTML and PDF export with a preview-first workflow that lets the user tune readable typography and page appearance before writing files. Add workspace-wide Markdown-to-HTML export with the same style controls.

## User experience

Every export command opens one shared **Export Studio** dialog before any save or batch operation begins. The dialog uses a restrained editorial layout: a compact control rail on the left and a paper-like live preview on the right. It remains visually consistent with Markdowner's existing neutral UI while making the output itself the focal point.

The controls are:

- Body font size, defaulting to 14 px to correct the oversized PDF output.
- Font family presets: Sans, Serif, and Mono. These use portable system font stacks so exported HTML stays self-contained.
- Text color and background color.
- Unitless line height.
- Paragraph spacing in pixels.
- Content padding in pixels, used as the HTML page inset and the PDF page inset.
- A4 or Letter paper size for PDF exports.

Changes update the preview immediately. A Reset button restores the export defaults. Confirming opens the native save dialog for a single document or starts the workspace batch immediately. Cancelling writes nothing. The last confirmed style is stored in local storage and becomes the starting point for later HTML and PDF exports.

## Export modes

The dialog supports four modes through one typed request model:

1. Current document to HTML.
2. Current document to PDF.
3. All workspace Markdown documents to HTML.
4. All workspace Markdown documents to PDF.

Workspace exports preserve each source file's path relative to the workspace under `<workspace>/exports/`, replace the Markdown extension with `.html` or `.pdf`, skip files already inside `exports`, ignore non-Markdown files and duplicate paths, and report the exported file count. For a batch preview, the active document is used when it belongs to the request; otherwise the first readable Markdown file is used.

## Architecture

`src/lib/exportDocument.ts` owns the durable export contract: validated style defaults, local-storage normalization, extension-agnostic workspace target generation, and CSS generation shared by the preview and final artifact. `buildExportHtml` accepts the style object and injects scoped export overrides after the collected application CSS, ensuring the selected values win for both HTML and PDF.

`src/shell/ExportDialog.tsx` owns draft control state and renders the live preview. It receives already available Markdown source and returns the confirmed style; it never writes files. `src/App.tsx` owns request orchestration, file reads, native save dialogs, artifact generation, error reporting, and success announcements.

The menu and command palette only open a typed export request. Existing direct export handlers are replaced by request openers and one confirmed-export handler, which keeps all four entry points behaviorally consistent.

## Preview fidelity

The preview uses the same `buildExportHtml` function and the same `ExportStyle` object as the final file. It renders inside a sandboxed `iframe` using `srcDoc`, so exported background, text color, typography, spacing, headings, tables, code blocks, and embedded images are isolated from the dialog chrome. PDF mode sizes the preview sheet to the selected paper ratio and enables the print CSS path.

Preview generation is asynchronous because images are embedded. A monotonically increasing request token prevents a slower older preview from replacing a newer one. The previous preview remains visible while a new one is being prepared, and an accessible status label communicates loading or failure.

## Failure handling

- Invalid or missing saved preferences fall back field-by-field to defaults.
- Numeric controls are clamped before CSS generation even if local storage is edited externally.
- A preview failure is shown inside the dialog and does not write any file.
- A single-document native save cancellation returns to the editor without an error.
- A missing workspace, empty target list, unreadable batch source, HTML write failure, or PDF generation failure uses the existing shell announcement and operation-error paths.
- The dialog remains open while export is in progress, disables controls and close actions, and closes only after success.

## Accessibility

Every control has a visible label and numeric value, native color inputs retain accessible names, the preview iframe has a descriptive title, status changes use `aria-live`, and all actions remain keyboard reachable. The dialog adapts to smaller windows by stacking controls above the preview and constraining both areas to the viewport.

## Testing

Library tests cover defaults, normalization, CSS escaping and clamping, HTML style injection, and HTML/PDF workspace target paths. Dialog tests cover initial values, live controls, reset, preview HTML, confirmation, cancellation, busy state, and PDF-only paper controls. App integration tests prove that no native write happens before confirmation, each single export uses the confirmed style, workspace HTML preserves relative paths and writes all files, workspace PDF keeps working through the dialog, and menu/command-palette entries expose all four modes.

The completion gate is focused Vitest, the full serial Vitest suite, the repository build, Rust PDF-export tests/build coverage, and a source-level requirement audit before the release workflow.
