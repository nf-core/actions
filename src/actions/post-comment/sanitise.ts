// Neutralises specific shapes inside the untrusted comment.md body, before
// body.ts prefixes and truncates it. None of this is a security boundary by
// itself: the comment always renders under the bot's own account, which a
// contributor cannot spoof (see README.md). Each shape here has no
// legitimate use in a lint report and a real cost if left alone.

import { MARKER_LOOKALIKE } from './marker.js'

// GitHub mention syntax: '@user' or '@org/team'. Matching the shape only,
// not a real username list, is deliberately loose: a false match just
// turns ordinary text into inline code, never the reverse.
const MENTION = /@[\w-]+(?:\/[\w-]+)?/g

// Markdown image syntax, and the raw HTML tag GitHub also renders as an
// image inside a comment body.
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)]*)\)/g
const HTML_IMG_TAG = /<img\b[^>]*>/gi

/** Strips any text shaped like one of this action's own markers out of `body`. */
function neutraliseMarkerLookalikes(body: string): string {
  return body.replace(MARKER_LOOKALIKE, (match) => `\`${match}\``)
}

/** Renders a '@mention' as inline code, so it cannot ping anyone or trigger a mention-based automation. */
function neutraliseMentions(body: string): string {
  return body.replace(MENTION, (match) => `\`${match}\``)
}

/**
 * Turns a markdown image embed into a plain link (drops the leading '!'),
 * and escapes a raw '<img>' tag into visible text. Neither renders as an
 * image afterwards. An ordinary '[text](url)' link is untouched.
 */
function neutraliseImageEmbeds(body: string): string {
  return body
    .replace(
      MARKDOWN_IMAGE,
      (_match, alt: string, url: string) => `[${alt}](${url})`
    )
    .replace(HTML_IMG_TAG, (tag) =>
      tag.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    )
}

/** Applies every content neutralisation the untrusted comment.md body needs before it is posted. */
export function sanitiseBody(body: string): string {
  return neutraliseImageEmbeds(
    neutraliseMentions(neutraliseMarkerLookalikes(body))
  )
}
