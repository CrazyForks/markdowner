/**
 * Shared Link extension options for every WYSIWYG editor instance (app,
 * playground, integration tests).
 *
 * Link marks must come ONLY from explicit sources: markdown syntax parsed on
 * load (`[text](url)`, `<https://…>`), the MarkdownLinkInputRule as the user
 * types the closing paren, or deliberate commands (Cmd+K, the selection
 * toolbar, the link popup). Bare words must never be linked implicitly:
 * linkifyjs treats any dotted word as a hostname — `.md` is the Moldova
 * ccTLD — so TipTap's defaults turned file names like `AGENTS.md` into
 * links, intermittently (autolink fires on load only for the first changed
 * textblock's last word, and while typing only after trailing whitespace).
 */
export const WYSIWYG_LINK_OPTIONS = {
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
  // The extension's paste rule (addPasteRules) is registered regardless of
  // `linkOnPaste`; `shouldAutoLink` is its only off switch.
  shouldAutoLink: () => false,
};
