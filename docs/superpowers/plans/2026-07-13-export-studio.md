# Export Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preview-first, style-configurable HTML/PDF export workflow and workspace-wide Markdown-to-HTML export.

**Architecture:** A shared export model in `exportDocument.ts` normalizes persisted style values, builds output paths, and produces the exact CSS used by preview and final artifacts. A focused `ExportDialog` edits a draft style and renders `buildExportHtml` in an iframe, while `App.tsx` orchestrates native save/batch writes. The Tauri bridge gains batch text writing and configurable PDF page margins.

**Tech Stack:** React 19, TypeScript, Radix dialog primitives, Tailwind CSS, Vitest/Testing Library, Tauri 2, Rust/WebKit PDFKit.

---

### Task 1: Shared export style and workspace targets

**Files:**
- Modify: `src/lib/exportDocument.test.ts`
- Modify: `src/lib/exportDocument.ts`

- [ ] **Step 1: Write failing tests for defaults, normalization, output targets, and generated CSS**

Add imports and assertions covering this public contract:

```ts
import {
  DEFAULT_EXPORT_STYLE,
  buildExportHtml,
  buildWorkspaceExportTargets,
  loadExportStyle,
  normalizeExportStyle,
  saveExportStyle,
} from './exportDocument';

it('uses a compact 14px default and normalizes unsafe persisted values', () => {
  expect(DEFAULT_EXPORT_STYLE.fontSize).toBe(14);
  expect(normalizeExportStyle({
    fontSize: 99,
    fontFamily: 'unknown',
    textColor: 'red',
    backgroundColor: '#fefefe',
    lineHeight: 0,
    paragraphSpacing: -4,
    contentPadding: 999,
    paperSize: 'Legal',
  })).toEqual({
    ...DEFAULT_EXPORT_STYLE,
    fontSize: 24,
    backgroundColor: '#fefefe',
    lineHeight: 1.2,
    paragraphSpacing: 0,
    contentPadding: 72,
  });
});

it('round-trips confirmed export style through storage', () => {
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  const style = { ...DEFAULT_EXPORT_STYLE, fontSize: 13, fontFamily: 'serif' as const };
  saveExportStyle(style, adapter);
  expect(loadExportStyle(adapter)).toEqual(style);
});

it('builds HTML targets with the workspace-relative folder structure', () => {
  expect(buildWorkspaceExportTargets({
    rootDir: '/tmp/project',
    workspaceDocuments: ['/tmp/project/README.md', '/tmp/project/docs/guide.markdown'],
    format: 'html',
  })).toEqual([
    { sourcePath: '/tmp/project/README.md', outputPath: '/tmp/project/exports/README.html', title: 'README' },
    { sourcePath: '/tmp/project/docs/guide.markdown', outputPath: '/tmp/project/exports/docs/guide.html', title: 'guide' },
  ]);
});

it('injects the selected export style after application CSS', async () => {
  const html = await buildExportHtml({
    title: 'Styled',
    source: '# Heading\n\nBody',
    activeDocumentPath: null,
    style: { ...DEFAULT_EXPORT_STYLE, fontSize: 13, fontFamily: 'serif', textColor: '#223344', backgroundColor: '#fffaf0', lineHeight: 1.7, paragraphSpacing: 10, contentPadding: 36 },
  });
  expect(html).toContain('font-size: 13px');
  expect(html).toContain('font-family: ui-serif');
  expect(html).toContain('color: #223344');
  expect(html).toContain('background: #fffaf0');
  expect(html).toContain('line-height: 1.7');
  expect(html).toContain('margin-block: 0 10px');
  expect(html).toContain('padding: 36px');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm vitest run src/lib/exportDocument.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: FAIL because `DEFAULT_EXPORT_STYLE`, `normalizeExportStyle`, persistence helpers, `buildWorkspaceExportTargets`, and the `style` option do not exist.

- [ ] **Step 3: Implement the shared model and CSS generator**

Add the following public model, then replace the PDF-specific target helper with the format-aware helper:

```ts
export type ExportFormat = 'html' | 'pdf';
export type ExportScope = 'document' | 'workspace';
export type ExportFontFamily = 'sans' | 'serif' | 'mono';

export interface ExportStyle {
  fontSize: number;
  fontFamily: ExportFontFamily;
  textColor: string;
  backgroundColor: string;
  lineHeight: number;
  paragraphSpacing: number;
  contentPadding: number;
  paperSize: 'A4' | 'Letter';
}

export const DEFAULT_EXPORT_STYLE: ExportStyle = {
  fontSize: 14,
  fontFamily: 'sans',
  textColor: '#202124',
  backgroundColor: '#ffffff',
  lineHeight: 1.6,
  paragraphSpacing: 8,
  contentPadding: 32,
  paperSize: 'A4',
};

export function normalizeExportStyle(value: unknown): ExportStyle;
export function loadExportStyle(storage?: Pick<Storage, 'getItem' | 'setItem'>): ExportStyle;
export function saveExportStyle(style: ExportStyle, storage?: Pick<Storage, 'getItem' | 'setItem'>): void;

export interface WorkspaceExportTarget {
  sourcePath: string;
  outputPath: string;
  title: string;
}

export function buildWorkspaceExportTargets(input: {
  rootDir: string;
  workspaceDocuments: readonly string[];
  format: ExportFormat;
}): WorkspaceExportTarget[];
```

Normalize numbers to `fontSize 10..24`, `lineHeight 1.2..2.2`, `paragraphSpacing 0..32`, and `contentPadding 0..72`; accept colors only when they match `^#[0-9a-fA-F]{6}$`; accept only declared enum values. Use the storage key `markdowner.exportStyle.v1` and catch storage/JSON failures.

Generate export CSS from fixed font stacks:

```ts
const EXPORT_FONT_STACKS: Record<ExportFontFamily, string> = {
  sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};
```

Append scoped rules after collected application CSS, including body/background, `.markdowner-export` font/line-height/padding/colors, relative `h1`–`h6` sizes, paragraph margin, and relative inline/code font sizes. Keep print code wrapping and media bounds.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm vitest run src/lib/exportDocument.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: all export document tests pass.

### Task 2: Native batch HTML writing and PDF page margins

**Files:**
- Create: `src-tauri/src/export_file.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/pdf_export.rs`
- Modify: `src/lib/desktop.ts`
- Modify: `src/lib/desktop.test.ts`

- [ ] **Step 1: Write failing TypeScript bridge tests**

Import `exportPdfFile`, `exportPdfFiles`, and `exportTextFiles` and assert exact Tauri payloads:

```ts
it('passes batch HTML files and PDF page margins to Tauri', async () => {
  await exportTextFiles([{ path: '/tmp/exports/a.html', contents: '<h1>A</h1>' }]);
  expect(invokeMock).toHaveBeenLastCalledWith('write_export_files', {
    files: [{ path: '/tmp/exports/a.html', contents: '<h1>A</h1>' }],
  });

  await exportPdfFile('/tmp/a.pdf', '<h1>A</h1>', 'A4', 36);
  expect(invokeMock).toHaveBeenLastCalledWith('write_pdf_file', {
    path: '/tmp/a.pdf', html: '<h1>A</h1>', paperSize: 'A4', pageMargin: 36,
  });

  await exportPdfFiles([{ path: '/tmp/a.pdf', html: '<h1>A</h1>', paperSize: 'A4', pageMargin: 28 }]);
  expect(invokeMock).toHaveBeenLastCalledWith('write_pdf_files', {
    files: [{ path: '/tmp/a.pdf', html: '<h1>A</h1>', paperSize: 'A4', pageMargin: 28 }],
  });
});
```

- [ ] **Step 2: Run the bridge test and verify RED**

Run:

```bash
pnpm vitest run src/lib/desktop.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: FAIL because `exportTextFiles` and page-margin parameters are missing.

- [ ] **Step 3: Implement and test the native text writer**

Create a small filesystem module:

```rust
use std::path::Path;

pub fn write_text_file(path: &str, contents: &str) -> Result<(), String> {
    let path = Path::new(path);
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::write_text_file;

    #[test]
    fn creates_nested_export_directories() {
        let temp = tempfile::tempdir().unwrap();
        let output = temp.path().join("exports/docs/guide.html");
        write_text_file(output.to_str().unwrap(), "<h1>Guide</h1>").unwrap();
        assert_eq!(std::fs::read_to_string(output).unwrap(), "<h1>Guide</h1>");
    }
}
```

Register `mod export_file`, make `write_export_file` call it, add a camelCase-deserialized `TextExportFile`, add `write_export_files`, and register the command in `generate_handler!`.

In `desktop.ts`, add:

```ts
export interface TextExportFile { path: string; contents: string }
export async function exportTextFiles(files: readonly TextExportFile[]): Promise<void> {
  await invoke<void>('write_export_files', { files });
}
```

- [ ] **Step 4: Thread and clamp PDF page margin through the bridge**

Add `pageMargin: number` to `PdfExportFile`, `exportPdfFile`, the Rust command arguments, and the Rust batch struct. Change `pdf_export::write_pdf_file` to accept the margin. In the macOS implementation use:

```rust
fn safe_page_margin(value: f64, paper_width: f64, paper_height: f64) -> f64 {
    if !value.is_finite() { return 0.0; }
    value.clamp(0.0, paper_width.min(paper_height) / 3.0)
}
```

Replace `__MARGIN__` with the clamped value in `PAGINATE_JS`. Add unit tests for negative, oversized, and non-finite margins.

- [ ] **Step 5: Run TypeScript and Rust focused tests and verify GREEN**

Run:

```bash
pnpm vitest run src/lib/desktop.test.ts --maxWorkers=1 --no-file-parallelism
cargo test --manifest-path src-tauri/Cargo.toml export_file
cargo test --manifest-path src-tauri/Cargo.toml pdf_export
```

Expected: all focused bridge and native tests pass.

### Task 3: Preview-first Export Studio dialog

**Files:**
- Create: `src/shell/ExportDialog.test.tsx`
- Create: `src/shell/ExportDialog.tsx`

- [ ] **Step 1: Write the failing dialog tests**

Test the public component with a deterministic preview builder:

```tsx
const request = {
  format: 'html' as const,
  scope: 'document' as const,
  title: 'notes',
  source: '# Notes',
  activeDocumentPath: '/tmp/notes.md',
  targetCount: 1,
};

it('edits style in a live preview and confirms the draft', async () => {
  const onConfirm = vi.fn();
  const buildPreview = vi.fn(async ({ style }) => `<!doctype html><style>font-size:${style.fontSize}px</style>`);
  render(<ExportDialog open request={request} initialStyle={DEFAULT_EXPORT_STYLE} busy={false} onOpenChange={() => {}} onConfirm={onConfirm} buildPreview={buildPreview} />);
  fireEvent.change(screen.getByLabelText('Body size'), { target: { value: '13' } });
  await waitFor(() => expect(screen.getByTitle('HTML export preview')).toHaveAttribute('srcdoc', expect.stringContaining('font-size:13px')));
  fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }));
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 13 }));
});

it('resets controls and only shows paper size for PDF', () => {
  const commonProps = {
    open: true,
    initialStyle: DEFAULT_EXPORT_STYLE,
    busy: false,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    buildPreview: vi.fn(async () => '<!doctype html><p>Preview</p>'),
  };
  const { rerender } = render(
    <ExportDialog {...commonProps} request={request} />,
  );
  expect(screen.queryByLabelText('Paper size')).toBeNull();
  rerender(
    <ExportDialog
      {...commonProps}
      request={{ ...request, format: 'pdf' }}
    />,
  );
  expect(screen.getByLabelText('Paper size')).toHaveValue('A4');
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByLabelText('Body size')).toHaveValue('14');
});
```

Also cover visible labels for text/background colors, font family, line height, paragraph spacing, content padding; cancel behavior; busy controls; preview failure; iframe title; and batch target count.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
pnpm vitest run src/shell/ExportDialog.test.tsx --maxWorkers=1 --no-file-parallelism
```

Expected: FAIL because `ExportDialog.tsx` does not exist.

- [ ] **Step 3: Implement the editorial dialog**

Export these types:

```ts
export interface ExportDialogRequest {
  format: ExportFormat;
  scope: ExportScope;
  title: string;
  source: string;
  activeDocumentPath: string | null;
  targetCount: number;
}

export interface ExportDialogProps {
  open: boolean;
  request: ExportDialogRequest | null;
  initialStyle: ExportStyle;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (style: ExportStyle) => void;
  buildPreview?: typeof buildExportHtml;
}
```

Use the existing `Dialog`, `Button`, `Input`, and `Label` primitives. Build a responsive `sm:max-w-[min(1120px,calc(100vw-2rem))]` dialog with a 280px control rail and a flexible preview stage. Use native range inputs with visible output values, a styled native select for font and paper presets, accessible color inputs, a Reset action, Cancel, and the mode-aware primary action.

Use an effect keyed by request and draft style to call `buildExportHtml({ ...request, style: draftStyle, forPrint: request.format === 'pdf', paperSize: draftStyle.paperSize })`. Protect state with a request counter and render the result in:

```tsx
<iframe
  title={`${request.format.toUpperCase()} export preview`}
  sandbox=""
  srcDoc={previewHtml}
  className="h-full w-full border-0 bg-white"
/>
```

- [ ] **Step 4: Run the dialog tests and verify GREEN**

Run:

```bash
pnpm vitest run src/shell/ExportDialog.test.tsx --maxWorkers=1 --no-file-parallelism
```

Expected: all Export Studio interaction tests pass.

### Task 4: Wire all four export flows into the shell

**Files:**
- Modify: `src/shell/AppMenu.test.tsx`
- Modify: `src/shell/AppMenu.tsx`
- Modify: `src/shell/commandPaletteCommands.test.ts`
- Modify: `src/shell/commandPaletteCommands.ts`
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing menu and command-palette tests for workspace HTML**

Add `onExportWorkspaceHtml` / `exportWorkspaceHtml`, assert `Export All Markdown to HTML…` appears before the PDF batch entry, is disabled without a workspace, and calls the supplied action.

Run:

```bash
pnpm vitest run src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: FAIL because the new HTML batch action and menu/command entries are absent.

- [ ] **Step 2: Implement the menu and command-palette entry**

Add the prop/action and entry with the exact identifiers:

```ts
{
  id: 'file.exportWorkspaceHtml',
  category: 'File',
  label: 'Export All Markdown to HTML…',
  disabled: !hasWorkspaceRoot,
  run: actions.exportWorkspaceHtml,
}
```

Use `Files` for HTML batch and keep `Printer` for PDF batch. Retain document/workspace disable semantics.

- [ ] **Step 3: Rewrite App export tests to require preview confirmation**

Before confirmation, assert `saveDialogMock`, `exportTextFileMock`, `exportTextFilesMock`, `exportPdfFileMock`, and `exportPdfFilesMock` have not been called. Adjust a style control, click the mode-aware Export button, then assert:

```ts
expect(exportPdfFileMock).toHaveBeenCalledWith(
  '/tmp/project/exports/meeting-notes.pdf',
  expect.stringContaining('font-size: 13px'),
  'A4',
  32,
);

expect(exportTextFilesMock).toHaveBeenCalledWith([
  { path: '/tmp/project/exports/README.html', contents: expect.stringContaining('Readme') },
  { path: '/tmp/project/exports/docs/guide.html', contents: expect.stringContaining('Guide') },
]);
```

Keep the existing live-WYSIWYG image tests, but click `Export HTML` / `Export PDF` after the preview appears. Add a test that confirmed preferences are reused by the next dialog.

- [ ] **Step 4: Run the App export tests and verify RED**

Run:

```bash
pnpm vitest run src/App.test.tsx --maxWorkers=1 --no-file-parallelism -t "export"
```

Expected: FAIL because App still opens native save/write operations immediately and lacks batch HTML.

- [ ] **Step 5: Implement App request orchestration**

Add state initialized from `loadExportStyle()`:

```ts
const [exportRequest, setExportRequest] = useState<ExportDialogRequest | null>(null);
const [exportStyle, setExportStyle] = useState<ExportStyle>(() => loadExportStyle());
```

Replace direct menu handlers with `openDocumentExport(format)` and `openWorkspaceExport(format)`. The document opener flushes the current WYSIWYG draft. The workspace opener builds format-aware targets, chooses the active file or first target as the representative preview, and reads only that file when needed.

Implement `handleConfirmExport(style)` through `withBusy`: persist the normalized style, open the save dialog only for document scope, generate all artifacts with `buildExportHtml({ style })`, send HTML batches through `exportTextFiles`, send PDF page margins through `exportPdfFile(s)`, announce the exact count/path, and close only on successful completion.

Use `settings.pdfPaperSize` as the dialog's initial paper size so the existing Preferences choice remains authoritative. When a PDF export confirms a different paper size, persist it through the existing `handleSettingsChange` path as well as the export-style storage.

Render:

```tsx
<ExportDialog
  open={exportRequest != null}
  request={exportRequest}
  initialStyle={exportStyle}
  busy={busy}
  onOpenChange={(open) => { if (!open && !busy) setExportRequest(null); }}
  onConfirm={(style) => void handleConfirmExport(style)}
/>
```

- [ ] **Step 6: Run focused shell and App tests and verify GREEN**

Run:

```bash
pnpm vitest run src/lib/exportDocument.test.ts src/lib/desktop.test.ts src/shell/ExportDialog.test.tsx src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.test.ts src/App.test.tsx --maxWorkers=1 --no-file-parallelism
```

Expected: all focused export, bridge, dialog, menu, palette, and App tests pass.

### Task 5: Full verification, integration, and release

**Files:**
- Verify all modified source/test/doc files
- Release-generated: `VERSION`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock`

- [ ] **Step 1: Run formatting/diff checks and full verification**

Run:

```bash
git diff --check
pnpm vitest run --maxWorkers=1 --no-file-parallelism
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Expected: no diff errors; all TypeScript and Rust tests pass; production build exits 0.

- [ ] **Step 2: Audit every requested behavior against current source and tests**

Run:

```bash
rg -n "Export Studio|Body size|Text color|Background color|Line height|Paragraph spacing|Content padding|Export All Markdown to HTML" src
rg -n "font-size: 14px|buildWorkspaceExportTargets|exportTextFiles|pageMargin" src src-tauri
```

Confirm that HTML and PDF both open the preview, all requested controls feed final CSS, PDF defaults to 14px body text, and workspace HTML preserves relative paths under `exports/`.

- [ ] **Step 3: Commit the implementation in logical units**

Use explicit paths only and Conventional Commit subjects:

```bash
git add src/lib/exportDocument.ts src/lib/exportDocument.test.ts src/lib/desktop.ts src/lib/desktop.test.ts src-tauri/src/export_file.rs src-tauri/src/lib.rs src-tauri/src/pdf_export.rs
git commit -m "feat(export): add configurable export styling"

git add src/shell/ExportDialog.tsx src/shell/ExportDialog.test.tsx src/shell/AppMenu.tsx src/shell/AppMenu.test.tsx src/shell/commandPaletteCommands.ts src/shell/commandPaletteCommands.test.ts src/App.tsx src/App.test.tsx
git commit -m "feat(export): add preview-first export studio"
```

- [ ] **Step 4: Complete the feature branch and merge it into main**

Follow `finishing-a-development-branch`. With the user's existing request to publish the finished update, use the local merge path after re-running verification, then return to `/Users/heechanpark/workspace/chann/markdowner` and confirm `main` contains the feature commits.

- [ ] **Step 5: Run the repository Headatever release flow**

Preview, then publish the patch release and synchronize all package metadata:

```bash
scripts/headatever.sh patch --dry-run
scripts/headatever.sh patch --push
pnpm sync-version
git diff --check
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
git commit -m "chore(release): sync version metadata for $(cat VERSION)"
git push
```

Expected: a new `v<version>` annotated tag exists on origin, `VERSION` and metadata versions match, and `main` is synchronized with `origin/main`.

- [ ] **Step 6: Verify the final remote state**

Run:

```bash
git status --short --branch
git log -6 --oneline --decorate
git ls-remote --tags origin "v$(cat VERSION)"
git rev-parse HEAD
git rev-parse origin/main
```

Expected: clean `main`, equal local/remote SHAs, and the new tag present on origin.
