// This action's half of the 'pr-comment' artifact contract: its own header,
// over the shared writer in src/lib/pr-comment-artifact.ts. See
// post-comment's own artifact.ts (the reader) and README.md for the shared
// shape.

import { writePrCommentArtifact } from '../../lib/pr-comment-artifact.js'

/**
 * The header every comment this action posts is filed under. See marker.ts
 * in post-comment. Distinct from 'lint' and 'template-version', the two
 * other headers a producer in this repo writes today, so none of the three
 * comments can ever collide.
 */
export const HEADER = 'branch'

/**
 * Writes this action's 'pr-comment' artifact under HEADER. See
 * writePrCommentArtifact() for the file shape.
 *
 * Never writes resolved.md: a pull request's head repository, head branch
 * and canonical repository are fixed for its whole life, so a blocked
 * pull request's decision here can never later flip to allowed. The only
 * route to becoming allowed is retargeting the base branch, which takes
 * the pull request outside this workflow's own 'branches: [main, master]'
 * filter, so it never runs here again either. See README.md.
 */
export function writeArtifact(
  dir: string,
  prNumber: string,
  comment?: string
): void {
  writePrCommentArtifact(dir, prNumber, HEADER, comment)
}
