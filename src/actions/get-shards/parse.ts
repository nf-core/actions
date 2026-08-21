// Parses nf-test's dry-run output. Kept separate from run.ts so the parsing
// rules have their own tests, without mocking @actions/exec.

const NO_TESTS_MARKER = 'No tests to execute'
const EXECUTED_PATTERN = /Executed (\d+) tests?/

/**
 * Reads the number of tests nf-test would run from its dry-run output.
 * Zero covers both 'No tests to execute' and an explicit 'Executed 0 tests'.
 * Throws if the output matches neither shape, so a format change fails loudly
 * instead of silently producing an empty matrix.
 */
export function parseDryRunOutput(output: string): number {
  if (output.includes(NO_TESTS_MARKER)) return 0

  const match = EXECUTED_PATTERN.exec(output)
  if (!match) {
    throw new Error(
      `Could not read a test count from nf-test's dry-run output. ` +
        `Expected a line containing 'Executed N tests' or '${NO_TESTS_MARKER}'. Got:\n${output}`
    )
  }
  return Number(match[1])
}
