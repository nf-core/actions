// Pure, testable pieces of validate-patch: the size cap default and its
// parsing. No I/O here.

import { assertPositiveInteger } from '../../lib/positive-integer.js'

/**
 * Fallback for the 'max-size-bytes' input. action.yml's declared default
 * must match this. 5 MiB is generous for a lint-fix diff (formatting
 * changes to text files across one pipeline repo), while still capping how
 * much an untrusted artifact can make this action read.
 */
export const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024

/** Parses the 'max-size-bytes' input. Throws unless it is a positive integer. */
export function parseMaxSizeBytes(raw: string): number {
  const value = Number(raw)
  assertPositiveInteger(value, 'max-size-bytes')
  return value
}
