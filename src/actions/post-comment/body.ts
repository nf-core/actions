// Pure composition of the final comment body. No I/O here. Neutralising
// mentions, image embeds and marker lookalikes in rawBody is sanitise.ts's
// job, done by the caller before this runs; this only prefixes and, when
// the result is too long, truncates.

import { trimToCodeUnitBoundary } from '../../lib/trim-to-code-unit-boundary.js'

// GitHub rejects an issue/pull-request comment body over 65536 characters.
// The real check is against the gzipped request payload, but the plain
// character count is a safe, conservative stand-in: anything within it is
// always accepted.
export const MAX_COMMENT_BODY_LENGTH = 65536

const TRUNCATION_NOTICE =
  "\n\n> **Note:** truncated. The full report was over GitHub's comment size limit."

// Appended to close a fenced code block a truncation cut lands inside (see
// endsInsideFence below), so the notice above renders as text under the
// block instead of as a line inside it.
const FENCE_CLOSE = '\n```'

const FENCE_LINE = /^```.*$/gm

/**
 * True when `text` ends with an unterminated ``` fenced code block: an odd
 * number of lines that open with ``` means the last one never closed.
 *
 * ponytail: only recognises plain ``` fences (the case every producer in
 * this repo emits), not ~~~ fences or a closing fence longer than its
 * opener. Widen this if a producer starts emitting either.
 */
function endsInsideFence(text: string): boolean {
  return (text.match(FENCE_LINE)?.length ?? 0) % 2 === 1
}

/**
 * Prefixes `rawBody` with `marker` and caps the result at
 * MAX_COMMENT_BODY_LENGTH. Truncates the body, never the marker: a later
 * run must still be able to find this comment by its marker even when the
 * report itself had to be cut. A cut that lands inside an open ``` fence
 * closes it first, and never splits a surrogate pair.
 */
export function buildCommentBody(marker: string, rawBody: string): string {
  const prefix = `${marker}\n`
  const budget = MAX_COMMENT_BODY_LENGTH - prefix.length
  if (rawBody.length <= budget) {
    return prefix + rawBody
  }

  const noticeBudget = Math.max(budget - TRUNCATION_NOTICE.length, 0)
  let truncated = trimToCodeUnitBoundary(rawBody, noticeBudget)
  if (endsInsideFence(truncated)) {
    const closeBudget = Math.max(noticeBudget - FENCE_CLOSE.length, 0)
    truncated = trimToCodeUnitBoundary(truncated, closeBudget) + FENCE_CLOSE
  }
  return prefix + truncated + TRUNCATION_NOTICE
}
