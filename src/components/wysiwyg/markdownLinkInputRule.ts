import { Extension, InputRule } from '@tiptap/core';

/**
 * Input rule that converts the literal Markdown link syntax `[text](url)` —
 * typed character-by-character in the WYSIWYG surface — into an inline link.
 *
 * Tiptap's link extension ships a paste rule and a URL-autolinker, but it
 * does NOT recognise the `[text](url)` form as the user types it. That's
 * exactly the "마크다운 형식으로 링크 입력을 하면 링크로 변환되어 보여야
 * 하는데 그러지 못합니다" gap the user reported on v0.260527.3.
 *
 * We use a custom InputRule (rather than Tiptap's `markInputRule`) because
 * the built-in helper applies the mark to the *last* capture group, but the
 * markdown link syntax needs the *first* group (the visible text) wrapped in
 * the mark with the *second* group (the URL) as the mark's `href` attribute.
 */
export const MarkdownLinkInputRule = Extension.create({
  name: 'markdownLinkInputRule',

  addInputRules() {
    const linkType = this.editor.schema.marks.link;
    if (!linkType) return [];

    return [
      new InputRule({
        // `[text](url)` where text is non-empty and url is at least one
        // character that isn't whitespace or `)`. The closing `)` is the
        // trigger character — the rule fires the moment the user types it.
        find: /\[([^\]\n]+?)\]\(([^\s)]+)\)$/,
        handler: ({ state, range, match }) => {
          const text = match[1];
          const href = match[2]?.trim();
          if (!text || !href) {
            // Returning null tells Tiptap's input-rules runner to skip this
            // match. Returning undefined (with no `tr.steps`) does the
            // same; we use null for an explicit "rejected" signal.
            return null;
          }
          const { tr } = state;
          // Replace the entire matched `[text](url)` span with just the
          // visible text, then apply the link mark over that text.
          tr.delete(range.from, range.to);
          const insertedFrom = range.from;
          tr.insertText(text, insertedFrom);
          tr.addMark(
            insertedFrom,
            insertedFrom + text.length,
            linkType.create({ href }),
          );
          // Clear the stored link mark so the next character the user types
          // (typically the space that terminated the pattern) is NOT part
          // of the link. Returning undefined here lets the runner see
          // `tr.steps.length > 0` and dispatch the prepared transaction —
          // returning null would short-circuit the dispatch.
          tr.removeStoredMark(linkType);
        },
      }),
    ];
  },
});

export default MarkdownLinkInputRule;
