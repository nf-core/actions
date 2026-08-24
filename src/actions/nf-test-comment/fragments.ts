// Reads the failed-leg fragment files a matrix job wrote, one per leg. No
// decision here: run.ts decides what an empty result means.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isEnoent } from '../../lib/is-enoent.js'

/**
 * Reads every file directly under `dir`, sorted by filename for a
 * deterministic order, trimmed, with any blank file dropped. Returns an
 * empty array when `dir` does not exist: the download step that would have
 * created it is skipped whenever no fragment artifact matched, which is the
 * normal case when no leg failed.
 */
export function readFragments(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }

  return names
    .map((name) => readFileSync(join(dir, name), 'utf8').trim())
    .filter((line) => line !== '')
}
