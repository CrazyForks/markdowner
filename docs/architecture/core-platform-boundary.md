# Core and Platform Layer Boundary

## Goal

Keep editor behavior portable by putting document logic in `markdowner-core` and keeping
platform-specific file dialogs, windows, and menus in shell crates such as
`markdowner-macos`.

## Responsibilities

### `markdowner-core`

- Markdown parsing and serialization via `parse_markdown` and `serialize_markdown`
- Platform-neutral document model in `Document` and `Block`
- Theme resolution and application in `ThemeSelection` and `apply_theme`
- Workspace state in `WorkspaceState`
- Platform capability contracts in `PlatformAdapter`, `FileDialogOptions`,
  `WindowDescriptor`, and `MenuDescriptor`
- Tests that run as a normal Rust library without an AppKit runtime

### `markdowner-macos`

- Implements `PlatformAdapter` with a macOS-specific shell
- Owns file open panels, window creation, and native menu installation
- Keeps AppKit-facing details private inside `appkit_bridge.rs`
- Translates core requests into macOS shell behavior without leaking macOS types back into
  `markdowner-core`

## Boundary Rules

1. `markdowner-core` public APIs may use Rust standard library types such as `PathBuf`, but
   must not expose AppKit or other macOS-only types.
2. Platform crates implement the adapter trait from core rather than adding UI dependencies
   to the core crate.
3. New platform work should add a sibling shell crate such as `markdowner-windows` that
   implements the same core adapter boundary.
4. Core tests belong in `crates/markdowner-core/tests` so they remain runnable without a
   macOS UI runtime.

## Current Layout

```text
Cargo workspace
├── crates/markdowner-core
│   ├── src/document.rs
│   ├── src/markdown.rs
│   ├── src/theme.rs
│   ├── src/workspace.rs
│   └── src/platform.rs
└── crates/markdowner-macos
    ├── src/shell.rs
    └── src/appkit_bridge.rs
```
