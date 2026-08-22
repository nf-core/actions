// Pure diff logic for verify-offline-run: which container images appeared
// after the pipeline ran that were not already cached by the download step.
// No I/O here.

/** Parses a newline-delimited file listing into a de-duplicated, sorted array. */
export function parseFileList(raw: string): string[] {
  const names = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return [...new Set(names)].sort()
}

/** Entries present in `after` but not in `before`. */
export function newEntries(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before)
  return after.filter((name) => !beforeSet.has(name))
}
