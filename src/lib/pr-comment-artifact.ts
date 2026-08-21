// Shared writer for a producer's half of the 'pr-comment' artifact contract.
// See post-comment's own artifact.ts (the reader) and README.md for the
// shared shape: pr_number.txt and header.txt always, comment.md and
// resolved.md only when there is something to say. Moved here once a second
// producer (branch, alongside template-version) needed it, per this repo's
// own rule of not letting two actions carry the same logic separately.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Writes pr_number.txt and header.txt into `dir`, creating it if needed,
 * plus comment.md when `comment` is given and resolved.md when `resolved`
 * is given. Omitting comment.md (rather than writing an empty one) is what
 * tells post-comment there is nothing to say; omitting resolved.md is what
 * tells it there is nothing to update a stale comment to, either.
 */
export function writePrCommentArtifact(
  dir: string,
  prNumber: string,
  header: string,
  comment?: string,
  resolved?: string
): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pr_number.txt'), prNumber)
  writeFileSync(join(dir, 'header.txt'), header)
  if (comment !== undefined) {
    writeFileSync(join(dir, 'comment.md'), comment)
  }
  if (resolved !== undefined) {
    writeFileSync(join(dir, 'resolved.md'), resolved)
  }
}
