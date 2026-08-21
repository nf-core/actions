// The hidden marker that lets a later run find and update the same comment
// instead of adding a new one. Namespaced so a pipeline's own header value
// (for example 'lint') can't collide with a different tool's own marker.
// An HTML comment is not rendered, so it stays invisible in the posted
// comment.

const MARKER_PREFIX = '<!-- nf-core-actions:pr-comment:'
const MARKER_SUFFIX = ' -->'
// The same shape validateHeader() accepts, so this matches every marker
// this action could ever build, not just the one the current run uses.
const HEADER_SHAPE = '[a-z][a-z0-9-]{0,63}'

/** Builds the hidden marker for a validated `header`. */
export function buildMarker(header: string): string {
  return `${MARKER_PREFIX}${header}${MARKER_SUFFIX}`
}

/**
 * Matches any text shaped like one of this action's own markers. Neither
 * MARKER_PREFIX nor MARKER_SUFFIX contains a regular-expression special
 * character, so they are safe to splice into a pattern as-is.
 *
 * findExistingCommentId() anchors its search on startsWith(), so a
 * lookalike buried inside an untrusted body is never found in place of the
 * real marker on its own. sanitise.ts uses this pattern too, to strip a
 * lookalike out of the body entirely, so a report cannot carry one at all.
 */
export const MARKER_LOOKALIKE = new RegExp(
  `${MARKER_PREFIX}${HEADER_SHAPE}${MARKER_SUFFIX}`,
  'g'
)
