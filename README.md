# Markdowner

[한국어 README](README.ko.md)

Markdowner is a Rust-first Markdown editor desktop app built with `Tauri v2`, `React`, `Vite`, and `Tiptap`. The current repository now includes a runnable macOS desktop shell, a shared Rust document core, and the first cross-platform foundation for a future Windows build.

## Current Status

- macOS local development run works through `pnpm tauri dev`
- macOS local debug build works through `pnpm tauri build --debug`
- the app shell includes file open, folder open, save, mode switching, theme switching, and a Rust command bridge to `markdowner-core`
- Windows is still a follow-up target, but the app architecture is now aligned for the same Tauri app shell

## Feature Summary

- WYSIWYG editing surface powered by Tiptap
- Source mode powered by CodeMirror 6
- Preview mode powered by React Markdown + GFM rendering
- File open and save through the desktop shell
- Workspace folder opening and file tree navigation
- Support for images, tables, checklists, and fenced code blocks
- Built-in light and dark themes
- Custom CSS theme import with persisted session state
- Rust `markdowner-core` remains the canonical Markdown/document layer

## Repository Layout

- `crates/markdowner-core`: Markdown parsing and serialization, document model, themes, workspace state, and runtime logic
- `crates/markdowner-macos`: earlier macOS shell/reference crate kept for boundary and regression coverage
- `src`: React/Vite frontend shell
- `src-tauri`: Tauri desktop shell, Rust command bridge, and app configuration
- `docs/architecture/core-platform-boundary.md`: notes on the core/platform split

## macOS Development Environment

Markdowner has been verified locally on macOS with the following toolchain available:

- `Node.js v22.20.0`
- `pnpm v10.33.0`
- `cargo 1.94.0`
- `rustc 1.94.0`
- Xcode Command Line Tools available through `xcode-select`

Minimum setup checklist:

1. Install a recent Rust toolchain
2. Install Node.js and pnpm
3. Install Xcode Command Line Tools

Example check commands:

```bash
node -v
pnpm -v
cargo -V
rustc -V
xcode-select -p
xcrun --version
```

## Install Dependencies

```bash
pnpm install
```

If `pnpm install` warns about ignored build scripts in your environment, approve the required builds and rerun install:

```bash
pnpm approve-builds
pnpm install
```

## Local Development Run on macOS

Start the desktop app in development mode:

```bash
pnpm tauri dev
```

What this does:

- starts the Vite dev server on `http://localhost:1420`
- compiles the Tauri Rust shell
- launches the local debug desktop executable

This command was verified locally in this repository. During startup, Tauri runs `pnpm dev` first, then runs the Rust desktop app from `target/debug/markdowner-desktop`.

If `pnpm tauri dev` fails immediately, first check whether port `1420` is already in use because the Vite dev server binds to that port by default.

## Local Build on macOS

### Build the Rust workspace

```bash
cargo build
```

On a fresh machine, the first Rust build downloads crate dependencies from crates.io and can take noticeably longer than subsequent builds.

### Build the frontend bundle

```bash
pnpm build
```

### Build the local Tauri debug app

```bash
pnpm tauri build --debug
```

Verified output path:

```bash
target/debug/markdowner-desktop
```

## Verify the Current App

Run the full Rust test suite:

```bash
cargo test
```

Useful focused checks:

```bash
cargo test -p markdowner-core
pnpm build
pnpm tauri build --debug
```

## Notes and Current Limitations

- The Tauri desktop shell is working locally on macOS, but packaged macOS `.app` bundling is not enabled yet. `src-tauri/tauri.conf.json` currently has `"bundle.active": false`.
- The frontend production bundle is currently large enough to trigger Vite's chunk size warning.
- Windows support is a planned next step rather than a completed local workflow.
- `crates/markdowner-macos` still exists as a reference implementation and regression target while the Tauri shell becomes the main app entrypoint.

## License

MIT. See `LICENSE` for details.
