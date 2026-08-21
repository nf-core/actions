// Pure parsing of `git apply --numstat` output. No I/O here; run.ts owns
// running git and reading the filesystem.

export interface NumstatEntry {
  /** Path as git reports it. Quoted by git itself if it contains unusual characters. */
  path: string
  /** Lines added, or null for a binary file (git prints '-'). */
  added: number | null
  /** Lines deleted, or null for a binary file (git prints '-'). */
  deleted: number | null
}

/** Parses one added/deleted count. '-' (binary file) is null; anything else must be a whole number. */
function parseCount(raw: string): number | null {
  if (raw === '-') return null
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN
}

/**
 * Parses one line per touched file, formatted as "<added>\t<deleted>\t<path>".
 * A path itself can contain a tab in principle, so everything after the
 * second tab is joined back together instead of split further.
 *
 * Skips a line that does not have at least three tab-separated fields, or
 * whose counts are not '-' or a whole number: git only emits well-formed
 * lines, but a caller must not turn one stray line (for example a warning
 * mixed into the same stream) into a NaN entry that is then counted and
 * rendered as if it were a real file.
 */
export function parseNumstat(stdout: string): NumstatEntry[] {
  const entries: NumstatEntry[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t')
    if (addedRaw === undefined || deletedRaw === undefined) continue
    if (pathParts.length === 0) continue
    const added = parseCount(addedRaw)
    const deleted = parseCount(deletedRaw)
    if (Number.isNaN(added) || Number.isNaN(deleted)) continue
    entries.push({ path: pathParts.join('\t'), added, deleted })
  }
  return entries
}
