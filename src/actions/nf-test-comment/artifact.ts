// This action's half of the 'pr-comment' artifact contract: its own header,
// over the shared writer in src/lib/pr-comment-artifact.ts. See
// post-comment's own artifact.ts (the reader) and README.md for the shared
// shape.

import { writePrCommentArtifact } from '../../lib/pr-comment-artifact.js'

/**
 * The header every comment this action posts is filed under. See marker.ts
 * in post-comment. Distinct from 'lint', 'branch' and 'template-version',
 * the other headers a producer in this repo writes today, so none of them
 * can ever collide.
 */
export const HEADER = 'nf-test-latest'

/** Writes this action's 'pr-comment' artifact under HEADER. See writePrCommentArtifact() for the file shape. */
export function writeArtifact(
  dir: string,
  prNumber: string,
  comment?: string,
  resolved?: string
): void {
  writePrCommentArtifact(dir, prNumber, HEADER, comment, resolved)
}
