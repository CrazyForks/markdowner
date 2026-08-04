# Always-On GitHub Flavored Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub Flavored Markdown an explicit, always-on contract across WYSIWYG, split-view preview, and every HTML-backed export without adding settings or user-facing guidance.

**Architecture:** Keep the existing Tiptap/Marked editor adapter and React-Markdown/remark-gfm render adapters. Add one small policy module for immutable Marked options and the shared remark plugin list, then lock the adapters together with one GFM fixture and cross-surface tests. Markdown source remains authoritative, and render-only operations must not mutate it.

**Tech Stack:** React 19, TypeScript 5.8, Tiptap 3, Marked through `@tiptap/markdown`, React-Markdown 9, remark-gfm 4, Vitest 4, Testing Library, Tauri 2, Rust.

## Global Constraints

- GFM is always enabled; there is no off state.
- Do not add a TypeScript or Rust settings field for GFM.
- Do not add a switch, command, badge, banner, onboarding message, status text, or help notice for GFM.
- Support GFM tables, task-list items, strikethrough, and extended autolinks in WYSIWYG, split view, and exports.
- Keep `breaks: false`; ordinary soft line breaks stay soft.
- Raw HTML remains non-executable in preview and exported HTML.
- Opening, previewing, exporting, or switching modes must not rewrite Markdown source.
- Preserve the current parser stack and existing image, link, syntax-highlight, and source-line component boundaries.
- Follow `/gcpr`: explicit staging, Conventional Commits, immediate ordinary push, clean worktree, and `0 0` local/tracking/live-remote proof.
- Repository `AGENTS.md` requires sequential execution in the main thread; use `executing-plans` and do not dispatch subagents.

---

## File Structure

- Create `src/lib/gfm.ts`: the only production definition of Marked GFM options and the remark-gfm plugin list.
- Create `src/lib/gfm.test.ts`: direct policy assertions proving GFM is on and hard-break expansion is off.
- Modify `src/App.tsx`: consume the shared Marked options in the production WYSIWYG extension list.
- Modify `src/editorPlayground.tsx`: keep the QA playground aligned with the production WYSIWYG parser.
- Modify `src/shell/MarkdownPreviewPane.tsx`: consume the shared remark plugin list.
- Modify `src/lib/exportDocument.ts`: consume the same remark plugin list for HTML, PDF, and image source rendering.
- Create `tests/fixtures/gfm-contract.md`: one source fixture for table, task list, strikethrough, extended autolinks, and hostile raw HTML.
- Modify `src/lib/wysiwygBehavior.integration.test.ts`: verify Tiptap node/mark parsing, serialization, and raw-HTML safety from the fixture.
- Modify `src/shell/MarkdownPreviewPane.test.tsx`: verify split-preview semantic DOM and raw-HTML safety from the fixture.
- Modify `src/lib/exportDocument.test.ts`: verify static export HTML semantics and raw-HTML safety from the fixture.
- Modify `src/AppCoreFlow.test.tsx`: drive the fixture through WYSIWYG, source, and split view while preserving exact source.
- Modify `src/shell/SettingsPanel.test.tsx`: prove there is no GFM control or explanatory copy.
- Modify `src/lib/settings.test.ts`: prove persisted defaults contain no GFM field.

---

### Task 1: Centralize the always-on GFM policy

**Files:**
- Create: `src/lib/gfm.ts`
- Create: `src/lib/gfm.test.ts`
- Modify: `src/App.tsx:1-80,1894-1948`
- Modify: `src/editorPlayground.tsx:18-40,46-66`
- Modify: `src/shell/MarkdownPreviewPane.tsx:1-55`
- Modify: `src/lib/exportDocument.ts:1-18,446-460`

**Interfaces:**
- Produces: `GFM_MARKED_OPTIONS` with the exact shape `{ gfm: true, breaks: false }`.
- Produces: `GFM_REMARK_PLUGINS`, a stable array containing `remarkGfm` exactly once.
- Consumed by: production WYSIWYG, the browser QA playground, split preview, and static export rendering.

- [ ] **Step 1: Write the failing policy test**

Create `src/lib/gfm.test.ts`:

```ts
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

import { GFM_MARKED_OPTIONS, GFM_REMARK_PLUGINS } from './gfm';

describe('always-on GFM policy', () => {
  it('enables GFM without converting soft line breaks to hard breaks', () => {
    expect(GFM_MARKED_OPTIONS).toEqual({ gfm: true, breaks: false });
  });

  it('uses remark-gfm exactly once in React-Markdown renderers', () => {
    expect(GFM_REMARK_PLUGINS).toEqual([remarkGfm]);
  });
});
```

- [ ] **Step 2: Run the policy test and verify the missing module failure**

Run:

```bash
pnpm exec vitest run src/lib/gfm.test.ts --maxWorkers=1
```

Expected: FAIL because `src/lib/gfm.ts` does not exist.

- [ ] **Step 3: Add the minimal policy module**

Create `src/lib/gfm.ts`:

```ts
import remarkGfm from 'remark-gfm';

export const GFM_MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
} as const;

export const GFM_REMARK_PLUGINS = [remarkGfm];
```

- [ ] **Step 4: Replace adapter-local configuration with the policy exports**

In `src/App.tsx` and `src/editorPlayground.tsx`, import `GFM_MARKED_OPTIONS` from `@/lib/gfm` and configure Tiptap with:

```ts
Markdown.configure({ markedOptions: GFM_MARKED_OPTIONS })
```

In `src/shell/MarkdownPreviewPane.tsx`, remove the direct `remark-gfm` import, import `GFM_REMARK_PLUGINS`, and pass:

```tsx
<ReactMarkdown
  remarkPlugins={GFM_REMARK_PLUGINS}
  rehypePlugins={rehypePlugins}
  components={markdownComponents}
>
  {source}
</ReactMarkdown>
```

In `src/lib/exportDocument.ts`, remove the direct `remark-gfm` import, import `GFM_REMARK_PLUGINS`, and use:

```ts
{
  remarkPlugins: GFM_REMARK_PLUGINS,
  components: createSourceLineMarkdownComponents({ activeDocumentPath, resolveImageSrc }),
}
```

- [ ] **Step 5: Run focused policy, preview, export, and WYSIWYG tests**

Run:

```bash
pnpm exec vitest run src/lib/gfm.test.ts src/shell/MarkdownPreviewPane.test.tsx src/lib/exportDocument.test.ts src/lib/wysiwygBehavior.integration.test.ts --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
```

Expected: all selected tests pass and TypeScript exits `0`.

- [ ] **Step 6: Review and commit the policy checkpoint**

Run:

```bash
git diff --check
git diff -- src/lib/gfm.ts src/lib/gfm.test.ts src/App.tsx src/editorPlayground.tsx src/shell/MarkdownPreviewPane.tsx src/lib/exportDocument.ts
git status --short
git add src/lib/gfm.ts src/lib/gfm.test.ts src/App.tsx src/editorPlayground.tsx src/shell/MarkdownPreviewPane.tsx src/lib/exportDocument.ts
git diff --cached --check
git commit -m "refactor(markdown): centralize always-on GFM policy"
git push origin main
```

Expected: one focused commit is pushed without staging unrelated files.

---

### Task 2: Prove the GFM contract across render adapters

**Files:**
- Create: `tests/fixtures/gfm-contract.md`
- Modify: `src/lib/wysiwygBehavior.integration.test.ts:12-52,380-440`
- Modify: `src/shell/MarkdownPreviewPane.test.tsx:1-85`
- Modify: `src/lib/exportDocument.test.ts:1-45`

**Interfaces:**
- Consumes: `GFM_MARKED_OPTIONS` and `GFM_REMARK_PLUGINS` from Task 1.
- Produces: `tests/fixtures/gfm-contract.md`, the canonical fixture used by adapter and app-flow tests.
- Proves: semantic table, task list, strike, two extended autolinks, and non-executable raw HTML.

- [ ] **Step 1: Add the canonical GFM fixture**

Create `tests/fixtures/gfm-contract.md` with these exact contents:

```markdown
# GFM Contract

| Feature | State |
| :--- | ---: |
| Table | Ready |

- [ ] Open task
- [x] Done task

~~Retired text~~

Visit https://example.com/gfm and www.example.org.

<script>window.__markdownerGfmProbe = true</script>
```

- [ ] **Step 2: Add a WYSIWYG fixture contract test**

Import the fixture and shared policy in `src/lib/wysiwygBehavior.integration.test.ts`:

```ts
import gfmContractFixture from '../../tests/fixtures/gfm-contract.md?raw';
import { GFM_MARKED_OPTIONS } from '@/lib/gfm';
```

Replace the local object in the test harness with:

```ts
Markdown.configure({ markedOptions: GFM_MARKED_OPTIONS })
```

Add this helper and test:

```ts
function collectDocumentFeatures(editor: Editor) {
  const nodeTypes: string[] = [];
  const markTypes: string[] = [];
  const linkHrefs: string[] = [];

  editor.state.doc.descendants((node) => {
    nodeTypes.push(node.type.name);
    for (const mark of node.marks) {
      markTypes.push(mark.type.name);
      if (mark.type.name === 'link' && typeof mark.attrs.href === 'string') {
        linkHrefs.push(mark.attrs.href);
      }
    }
  });

  return { nodeTypes, markTypes, linkHrefs };
}

it('parses the always-on GFM contract without executable raw HTML', () => {
  const editor = buildEditor(gfmContractFixture);
  const features = collectDocumentFeatures(editor);

  expect(features.nodeTypes).toEqual(expect.arrayContaining(['table', 'taskList', 'taskItem']));
  expect(features.markTypes).toContain('strike');
  expect(features.linkHrefs).toEqual(
    expect.arrayContaining(['https://example.com/gfm', 'http://www.example.org']),
  );
  expect(editor.getHTML()).not.toContain('<script');
  expect(editor.getMarkdown()).toContain('| Feature |');
  expect(editor.getMarkdown()).toContain('- [x] Done task');

  editor.destroy();
});
```

- [ ] **Step 3: Add the split-preview fixture contract test**

Import the raw fixture in `src/shell/MarkdownPreviewPane.test.tsx` and add:

```tsx
it('renders the complete always-on GFM contract safely', () => {
  const { container } = render(<MarkdownPreviewPane source={gfmContractFixture} />);

  expect(container.querySelector('table')).toBeInTheDocument();
  expect(container.querySelectorAll('li.task-list-item > input[type="checkbox"]')).toHaveLength(2);
  expect(container.querySelector('del')).toHaveTextContent('Retired text');
  expect(container.querySelector('a[href="https://example.com/gfm"]')).toBeInTheDocument();
  expect(container.querySelector('a[href="http://www.example.org"]')).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
  expect((window as Window & { __markdownerGfmProbe?: boolean }).__markdownerGfmProbe).toBeUndefined();
});
```

- [ ] **Step 4: Strengthen the static export HTML contract test**

Import the fixture in `src/lib/exportDocument.test.ts`, then replace the weak list-only GFM test with:

```ts
it('renders the complete always-on GFM contract to safe static HTML', () => {
  const html = renderMarkdownToHtml(gfmContractFixture, null);

  expect(html).toContain('<table>');
  expect(html).toContain('class="contains-task-list"');
  expect(html).toContain('<del>Retired text</del>');
  expect(html).toContain('href="https://example.com/gfm"');
  expect(html).toContain('href="http://www.example.org"');
  expect(html).not.toContain('<script');
  expect(html).toContain('&lt;script&gt;window.__markdownerGfmProbe = true&lt;/script&gt;');
});
```

- [ ] **Step 5: Run the three adapter contract tests**

Run:

```bash
pnpm exec vitest run src/lib/wysiwygBehavior.integration.test.ts src/shell/MarkdownPreviewPane.test.tsx src/lib/exportDocument.test.ts --maxWorkers=1
```

Expected: all assertions pass. If an assertion exposes a real adapter gap, make the smallest change at that adapter boundary and rerun this exact command; do not weaken the fixture or assertion.

- [ ] **Step 6: Review and commit the renderer-contract checkpoint**

Run:

```bash
git diff --check
git status --short
git add tests/fixtures/gfm-contract.md src/lib/wysiwygBehavior.integration.test.ts src/shell/MarkdownPreviewPane.test.tsx src/lib/exportDocument.test.ts
git diff --cached --check
git commit -m "test(markdown): verify GFM renderer contract"
git push origin main
```

Expected: the fixture and its adapter tests are pushed as one logical test checkpoint.

---

### Task 3: Lock source preservation and the no-UI requirement

**Files:**
- Modify: `src/AppCoreFlow.test.tsx:365-428`
- Modify: `src/shell/SettingsPanel.test.tsx:80-145`
- Modify: `src/lib/settings.test.ts:1-80`

**Interfaces:**
- Consumes: `tests/fixtures/gfm-contract.md` from Task 2.
- Proves: exact source survives WYSIWYG-to-source-to-split transitions.
- Proves: neither persisted settings nor Settings UI expose GFM.

- [ ] **Step 1: Upgrade the existing core mode-switch test to the GFM fixture**

Import the fixture in `src/AppCoreFlow.test.tsx`:

```ts
import gfmContractFixture from '../tests/fixtures/gfm-contract.md?raw';
```

In the test named `opens a Markdown file and switches WYSIWYG, source, and split modes without runtime errors`, use:

```ts
const openedPath = '/tmp/project/gfm-contract.md';
const openedSource = gfmContractFixture;
```

Replace its surface assertions with:

```ts
const wysiwygSurface = screen.getByTestId('editor-surface-wysiwyg');
expect(wysiwygSurface).toHaveTextContent('GFM Contract');
expect(wysiwygSurface.querySelector('table')).toBeInTheDocument();
expect(wysiwygSurface.querySelector('s')).toHaveTextContent('Retired text');

fireEvent.keyDown(window, { key: 'k', metaKey: true });
fireEvent.keyDown(window, { key: 'e', metaKey: true });
expect(await screen.findByLabelText('Source editor')).toHaveValue(openedSource);

fireEvent.keyDown(window, { key: 'k', metaKey: true });
fireEvent.keyDown(window, { key: 's', metaKey: true });
await waitFor(() => {
  const preview = screen.getByTestId('editor-surface-preview');
  expect(preview.querySelector('table')).toBeInTheDocument();
  expect(preview.querySelector('del')).toHaveTextContent('Retired text');
  expect(preview.querySelector('script')).toBeNull();
});
```

Keep the existing `runtimeErrors.expectClean()` assertion.

- [ ] **Step 2: Assert the persisted settings model has no GFM field**

Add to `src/lib/settings.test.ts`:

```ts
describe('always-on GFM', () => {
  it('does not expose a persisted dialect preference', () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty('gfmEnabled');
    expect(DEFAULT_SETTINGS).not.toHaveProperty('markdownDialect');
  });
});
```

- [ ] **Step 3: Assert Settings has no GFM control or explanation**

Add to `src/shell/SettingsPanel.test.tsx`:

```tsx
it('does not expose a GFM setting or explanation', () => {
  renderPanel();

  expect(screen.queryByRole('switch', { name: /gfm|github flavored markdown/i })).toBeNull();
  expect(screen.queryByText(/gfm|github flavored markdown/i)).toBeNull();
});
```

- [ ] **Step 4: Run core-flow and settings regressions**

Run:

```bash
pnpm exec vitest run src/AppCoreFlow.test.tsx src/lib/settings.test.ts src/shell/SettingsPanel.test.tsx --maxWorkers=1
```

Expected: all selected tests pass, the source editor value equals the fixture byte-for-byte, and no GFM UI is found.

- [ ] **Step 5: Review and commit the app-contract checkpoint**

Run:

```bash
git diff --check
git status --short
git add src/AppCoreFlow.test.tsx src/lib/settings.test.ts src/shell/SettingsPanel.test.tsx
git diff --cached --check
git commit -m "test(app): preserve always-on GFM across modes"
git push origin main
```

Expected: source-preservation and no-UI tests are pushed without unrelated files.

---

### Task 4: Verify the installed application and publication state

**Files:**
- Runtime fixture: `tests/fixtures/gfm-contract.md`
- Runtime screenshots: `/tmp/markdowner-gfm-wysiwyg.png`, `/tmp/markdowner-gfm-split.png`
- Runtime export: `/tmp/markdowner-gfm-runtime.html`

**Interfaces:**
- Consumes: all implementation and tests from Tasks 1-3.
- Produces: fresh automated test output, an installed signed app, two mode screenshots, an exported HTML artifact, and Git parity evidence.

- [ ] **Step 1: Run the complete automated verification matrix**

Run each command and retain its exit status:

```bash
pnpm test
pnpm exec tsc --noEmit --pretty false
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
git diff --check
```

Expected: 0 failed frontend tests, both install/update shell suites pass, all Rust tests pass, TypeScript exits `0`, Clippy emits no warning, and `git diff --check` is silent.

- [ ] **Step 2: Build and install the release application**

Run:

```bash
pnpm build:install
codesign --verify --deep --strict --verbose=2 /Applications/Markdowner.app
```

Expected: release bundle installs at `/Applications/Markdowner.app`; codesign reports `valid on disk` and `satisfies its Designated Requirement`. Notarization is not required for this local ad-hoc build.

- [ ] **Step 3: Relaunch the installed app with the GFM fixture**

Run:

```bash
osascript -e 'tell application "Markdowner" to quit'
open -na /Applications/Markdowner.app --args /Volumes/990EVO+/workspace/chann/markdowner/tests/fixtures/gfm-contract.md
osascript -e 'delay 4' -e 'tell application "Markdowner" to activate'
```

Expected: the installed release process opens `gfm-contract.md`, not a previously running bundle.

- [ ] **Step 4: Capture and inspect WYSIWYG and split-view evidence**

Activate the exact View menu items and capture screenshots:

```bash
osascript -e 'tell application "System Events" to tell process "Markdowner" to click menu item "WYSIWYG (⌥1 · ⌘K ⌘W)" of menu "View" of menu bar 1' -e 'delay 2'
screencapture -x /tmp/markdowner-gfm-wysiwyg.png
osascript -e 'tell application "System Events" to tell process "Markdowner" to click menu item "Split-view (⌥3 · ⌘K ⌘S)" of menu "View" of menu bar 1' -e 'delay 2'
screencapture -x /tmp/markdowner-gfm-split.png
```

Inspect both images with the local image viewer. Each must visibly contain the semantic table, two task items, struck text, and linked URLs; neither may show executable raw-HTML output or a GFM setting/notice.

- [ ] **Step 5: Export and inspect one installed-app HTML artifact**

From the installed app, invoke **File → Export as HTML…**, keep the default preview styling, select **Export HTML**, and save exactly to `/tmp/markdowner-gfm-runtime.html`. Then run:

```bash
test -s /tmp/markdowner-gfm-runtime.html
rg -n '<table|contains-task-list|<del>|href="https://example.com/gfm"|href="http://www.example.org"' /tmp/markdowner-gfm-runtime.html
if rg -n '<script' /tmp/markdowner-gfm-runtime.html; then exit 1; fi
```

Expected: the artifact is non-empty, contains all five GFM evidence patterns, and contains no executable script tag. The raw script source may appear only as escaped text.

- [ ] **Step 6: Perform the completion and remote-parity audit**

Run:

```bash
git status --short
git rev-list --left-right --count 'HEAD...@{u}'
git rev-parse HEAD
git rev-parse '@{u}'
git ls-remote --heads origin refs/heads/main
```

Expected: status is empty, divergence is `0 0`, and local HEAD, tracking SHA, and live `refs/heads/main` SHA are identical.

Re-read `docs/superpowers/specs/2026-08-04-always-on-gfm-design.md` and map every acceptance criterion to the fixture tests, installed-app screenshots, exported artifact, or Git evidence before reporting completion.
