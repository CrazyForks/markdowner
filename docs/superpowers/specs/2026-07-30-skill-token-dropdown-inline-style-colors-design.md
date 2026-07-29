# Skill Token Dropdown and Inline Style Colors Design

## Summary

Markdowner will make installed Claude Code and Codex skills discoverable while
editing and will let users customize the appearance of skill tokens and inline
code independently for light and dark themes.

The feature has three connected outcomes:

1. Source and WYSIWYG editors offer installed skill names in an autocomplete
   dropdown after `/` or `$`.
2. Source, WYSIWYG, and Preview render known skill tokens and inline code with a
   shared, theme-aware color palette.
3. Settings exposes light and dark text/background colors for both inline
   styles, with live previews and per-theme reset.

Export Preview keeps its existing export-specific code-style controls. Editor
appearance settings do not change exported HTML or PDF styling.

## Goals

- Preserve existing WYSIWYG slash commands and `Cmd+/` turn-into behavior.
- Offer only installed, known skills and preserve the user's `/` or `$` prefix.
- Support keyboard-first and pointer-based selection in both editable modes.
- Avoid suggestions and highlighting inside inline code or fenced/code blocks.
- Apply one active palette consistently across Source, WYSIWYG, and Preview.
- Store light and dark colors independently and switch them immediately with
  the effective app theme.
- Migrate older settings safely by defaulting each missing or invalid field.

## Non-goals

- Selecting a token does not execute the skill.
- The dropdown does not search remote skill registries or install skills.
- Export Preview, HTML export, and PDF export retain their own style model.
- Code-block syntax palettes remain controlled by the existing Code Block Theme
  setting.
- This work does not redesign the Command Palette.

## Interaction Design

### WYSIWYG

At the start of a block, `/` opens the existing slash menu with two ordered
sections:

1. `Blocks` contains the existing paragraph, heading, list, table, image, and
   formatting actions.
2. `Skills` contains installed skills rendered with the current `/` prefix.

The existing fuzzy ranking applies within the available items. A query such as
`/gi` can therefore surface `/git-commit` and related skills alongside any
matching block commands.

After whitespace in the middle of a block, `/` opens a skill-only menu. `$`
opens the skill-only menu at any token boundary. Examples:

- `/gi` + selection inserts `/git-commit`.
- `$gi` + selection inserts `$git-commit`.
- The typed prefix is retained and only the query range is replaced.

Suggestions open only when the trigger begins at the start of text or follows
whitespace. Ordinary word contents, URL/path text, non-empty selections,
inline-code marks, and code-block nodes do not open the menu.

Both menus support:

- fuzzy filtering by installed skill name;
- Up/Down navigation;
- Enter or Tab selection;
- Escape dismissal;
- pointer hover and click;
- active-item scrolling and viewport-aware placement;
- accessible listbox/option semantics.

The existing `Cmd+/` convert menu stays block-only and never includes skills.

### Source

CodeMirror receives a skill completion source configured with the installed
skill-name set. `/` and `$` open skill completions at valid token boundaries.
The completion label and inserted text use the exact prefix the user typed.

The completion source refuses inline-code and fenced-code syntax-tree contexts
and does not activate inside ordinary words, URLs, or file paths. CodeMirror's
completion key handling supplies Up/Down, Enter/Tab, Escape, pointer selection,
and active-item scrolling. Its completion tooltip is themed to match the
existing slash-menu surface.

### Preview

Preview remains read-only and has no dropdown. A small rehype transformation
uses the shared skill-token matcher to wrap known tokens in a
`preview-skill-token` span. It skips `code` and `pre` descendants, so explicit
inline code and code blocks retain code semantics and never receive a second
skill-token treatment.

## Settings Model

The persisted settings contract adds eight camelCase string fields:

- `skillTokenLightTextColor`
- `skillTokenLightBackgroundColor`
- `skillTokenDarkTextColor`
- `skillTokenDarkBackgroundColor`
- `inlineCodeLightTextColor`
- `inlineCodeLightBackgroundColor`
- `inlineCodeDarkTextColor`
- `inlineCodeDarkBackgroundColor`

Each value must be a six-digit hexadecimal color in `#RRGGBB` form. TypeScript
and Rust normalize malformed or missing values independently, so one invalid
field cannot reset another valid field.

Defaults preserve the current neutral Zinc appearance:

| Style | Theme | Text | Background |
| --- | --- | --- | --- |
| Skill token | Light | `#18181B` | `#F4F4F5` |
| Skill token | Dark | `#FAFAFA` | `#27272A` |
| Inline code | Light | `#18181B` | `#F4F4F5` |
| Inline code | Dark | `#FAFAFA` | `#27272A` |

The existing `highlightSkillTokens` boolean continues to enable or disable
skill-token decoration. Color fields remain editable while highlighting is off,
allowing a palette to be prepared before re-enabling it.

## Settings UI

The Editor settings section gains an `Inline styles` group immediately below
the Skill Token Highlighting switch.

The selected visual design is theme-first:

- a Light/Dark segmented control selects which palette is being edited without
  changing the app theme;
- a Skill token card contains a live `$git-commit` preview plus Text and
  Background color controls;
- an Inline code card contains a live `pnpm test` preview plus the same controls;
- each control pairs a native color well with an editable uppercase hex value;
- `Reset Light colors` or `Reset Dark colors` restores all four values for the
  selected palette.

Editing the currently active tone updates every editor surface immediately.
Editing the inactive tone persists it without changing the current document
appearance; it becomes active on the next theme switch.

## Theme and Style Application

A focused palette helper resolves `light` or `dark` from the effective app
theme. Built-in themes use their explicit kind. System theme changes already
resolve to a built-in light or dark snapshot. When a Custom CSS theme is active,
the current OS color-scheme preference selects the tone.

The resolved palette is exposed on the document root through four active CSS
variables:

- `--skill-token-text-color`
- `--skill-token-background-color`
- `--inline-code-text-color`
- `--inline-code-background-color`

The variables are the single color source for:

- `.cm-skill-token`, `.wysiwyg-skill-token`, and
  `.preview-skill-token`;
- Source inline-code decorations;
- WYSIWYG inline `code`;
- Preview inline `code`.

Font family, sizing, border radius, spacing, and document semantics remain
unchanged. Skill-token decoration continues to use a non-layout-shifting outer
shadow in Source and WYSIWYG.

Source inline code receives a CodeMirror decoration based on Markdown syntax
nodes. This permits a custom background without applying it to fenced code
blocks or to programming-language tokens within those blocks.

Imported custom CSS remains able to style unrelated document content, while the
explicit Inline styles setting is authoritative for these four colors.

## Component Boundaries

- `skillTokens.ts` remains the shared name/token matcher.
- A focused WYSIWYG skill-menu module owns inline `/` and `$` trigger parsing,
  insertion, keyboard behavior, and list rendering.
- `SlashCommandMenu` accepts installed skill names and adds a Skills section
  only in typed insert mode.
- A focused Source completion module owns CodeMirror completion and inline-code
  decoration.
- A focused Preview rehype module owns read-only token wrapping.
- A focused inline-style palette module owns defaults, normalization, tone
  resolution, CSS-variable mapping, and per-tone resets.
- A focused Settings component owns the theme-first color-control UI and live
  previews.

These units communicate through explicit skill-name sets and the existing
settings object. They do not fetch skills independently.

## Data Flow

1. The existing Tauri command scans installed skills once during app bootstrap.
2. App stores the deduplicated names in the existing skill-name set.
3. App passes the set to WYSIWYG menus, the Source completion extension, and
   Preview's token transformer.
4. Settings load through the existing TypeScript/Rust normalization boundary.
5. App resolves the active inline-style tone and writes the corresponding
   palette to root CSS variables.
6. A Settings change uses the existing optimistic save flow. The active palette
   updates immediately; persistence failures follow the existing settings error
   handling and rollback behavior.

## Error and Edge-case Handling

- No installed skills means no skill suggestions and no skill highlighting;
  block slash commands continue to work.
- Duplicate skill names are removed before menus or completions are built.
- Invalid skill names remain excluded by the existing registry parser.
- Malformed color strings fall back field-by-field to defaults.
- Token suggestions and highlighting skip code contexts in all three surfaces.
- Closing a menu does not alter typed text.
- Selecting a stale suggestion after the document changes is refused rather
  than replacing an unrelated range.
- Theme changes during color editing retain the UI's selected edit tone while
  updating the live document palette independently.

## Testing

### Unit coverage

- color normalization, defaults, tone resolution, and per-tone reset;
- Rust settings defaults, malformed-value fallback, and round-trip persistence;
- skill trigger parsing for block-start `/`, inline `/`, `$`, false-positive
  paths, and code contexts;
- prefix-preserving completion insertion and fuzzy filtering;
- Source inline-code decorations excluding fenced blocks;
- Preview wrapping excluding inline/fenced code.

### Component and integration coverage

- WYSIWYG unified Blocks/Skills grouping and skill-only dropdown behavior;
- keyboard and pointer selection;
- Source completion extension receives installed skills;
- Settings renders both palette cards, edits all color fields, resets only the
  selected tone, and preserves the highlight toggle;
- App persists settings, applies active CSS variables, switches palettes with
  light/dark theme changes, and passes skill names to every consumer;
- Source, WYSIWYG, and Preview use the same CSS-variable contract.

### Runtime verification

- Build and install the macOS app.
- Verify `/` and `$` dropdowns in Source and WYSIWYG with real installed skills.
- Confirm no dropdown/highlight inside inline or fenced code.
- Change all four colors for Light and Dark, switch themes, relaunch, and verify
  persistence.
- Verify Source, WYSIWYG, and Preview visually match the active palette.
- Confirm export-specific inline-code colors remain independent.

## Release and Git Checkpoints

The work will be committed and pushed in verified outcome-based checkpoints:

1. design and implementation plan;
2. persisted theme-aware color contract;
3. Source and Preview styling support;
4. WYSIWYG and Source skill dropdown support;
5. Settings UI and App integration;
6. any corrective checkpoint discovered by full verification.

Each checkpoint must pass its focused tests, `git diff --check`, ordinary push,
and `HEAD...@{upstream} = 0 0`. The final audit also runs the full relevant test,
type, Rust, lint, build/install, and installed-app UI checks.
