// Pure validation of the two untrusted, structured artifact fields. No I/O
// here; artifact.ts owns reading the files, run.ts owns using the result.

// Lowercase letters, digits and hyphens, starting with a letter, up to 64
// characters. Matches every header a producer in this repo writes today
// ('lint'), while staying strict enough that a crafted header cannot spell
// out another tool's own marker text (see marker.ts) or carry anything a
// shell or Markdown renderer could interpret specially.
const HEADER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/**
 * Validates header.txt. Rejects, rather than sanitises, anything outside
 * HEADER_PATTERN: silently rewriting a bad header would let two different
 * inputs collapse onto the same marker.
 */
export function validateHeader(raw: string): string {
  const header = raw.trim()
  if (!HEADER_PATTERN.test(header)) {
    throw new Error(
      `header.txt must match ${HEADER_PATTERN.source} (lowercase letters, digits and hyphens, starting with a letter, at most 64 characters). Got: ${JSON.stringify(raw)}`
    )
  }
  return header
}

const PR_NUMBER_PATTERN = /^[1-9][0-9]*$/

/**
 * Validates pr_number.txt as a plain positive integer with no leading zero,
 * no sign and no surrounding text. This only checks the value is
 * well-formed; run.ts still verifies it against the commit that triggered
 * this workflow before using it.
 */
export function validatePrNumber(raw: string): number {
  const trimmed = raw.trim()
  if (!PR_NUMBER_PATTERN.test(trimmed)) {
    throw new Error(
      `pr_number.txt must be a positive integer with no leading zero. Got: ${JSON.stringify(raw)}`
    )
  }
  return Number(trimmed)
}
