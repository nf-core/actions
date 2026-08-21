// Reads the pr-comment artifact contract from disk. No validation of the
// field contents here (see validate.ts); this only decides what is present,
// and rejects a file this action must not read: a symlink (followed into
// whatever it points at) or one too large to load safely.

import { lstatSync, readFileSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { describeType } from '../../lib/file-type.js'
import { isEnoent } from '../../lib/is-enoent.js'

export interface RawArtifact {
  prNumberRaw: string
  headerRaw: string
  /** undefined when comment.md is absent: 'nothing to say', not an error. */
  bodyRaw: string | undefined
}

// pr_number.txt and header.txt are a short id and a short slug; 4 KiB is
// generous for either while still capping them. comment.md is a full lint
// report: capped well above MAX_COMMENT_BODY_LENGTH (body.ts's character
// count, not a byte count) so a legitimate multi-byte-UTF-8 report still
// fits, while a wildly oversized file is still rejected before it is read
// into memory at all.
const MAX_SMALL_FIELD_BYTES = 4096
const MAX_COMMENT_MD_BYTES = 1024 * 1024

/**
 * Reads `path` as UTF-8, or undefined if it is absent. Mirrors
 * validate-patch's run.ts: lstat, not stat, so a symlink is judged by what
 * it is instead of being followed into whatever it points at, and a size
 * cap is enforced before the file is read.
 */
function readOptional(path: string, maxBytes: number): string | undefined {
  let stat: Stats
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (isEnoent(error)) return undefined
    throw error
  }

  if (!stat.isFile()) {
    throw new Error(
      `'${path}' is not a regular file (found ${describeType(stat)}). Refusing to read it.`
    )
  }
  if (stat.size > maxBytes) {
    throw new Error(
      `'${path}' is ${String(stat.size)} bytes, over the ${String(maxBytes)} byte cap.`
    )
  }

  return readFileSync(path, 'utf8')
}

/**
 * Reads pr_number.txt, header.txt and comment.md from `dir`.
 *
 * Returns undefined when pr_number.txt itself is absent. This is the
 * normal case, not an error: the whole artifact is missing whenever the
 * producing job never ran on a pull request, or a timeout or cancellation
 * skipped its `if: always()` upload step, and this also covers the
 * directory itself not existing at all.
 *
 * Throws when pr_number.txt is present but header.txt is not: every
 * producer in this repo writes both together in one step, so that
 * combination means the artifact is malformed, not that there is nothing
 * to post.
 */
export function readArtifact(dir: string): RawArtifact | undefined {
  const prNumberRaw = readOptional(
    join(dir, 'pr_number.txt'),
    MAX_SMALL_FIELD_BYTES
  )
  if (prNumberRaw === undefined) return undefined

  const headerRaw = readOptional(join(dir, 'header.txt'), MAX_SMALL_FIELD_BYTES)
  if (headerRaw === undefined) {
    throw new Error(
      `'${dir}' has pr_number.txt but no header.txt. A producer always writes both together, so this artifact is malformed.`
    )
  }

  return {
    prNumberRaw,
    headerRaw,
    bodyRaw: readOptional(join(dir, 'comment.md'), MAX_COMMENT_MD_BYTES)
  }
}
