// Parses TAP (Test Anything Protocol) output from nf-test. Kept separate
// from run.ts so the parsing rules have their own tests, without mocking
// @actions/exec or the filesystem.

export type TapStatus = 'pass' | 'fail' | 'skip' | 'todo'

export interface TapTest {
  number?: number
  description: string
  status: TapStatus
}

export interface TapCounts {
  total: number
  passed: number
  failed: number
  /** TODO tests only. */
  todo: number
  /** SKIP tests only. */
  skip: number
  /** Sum of todo and skip: neither a pass nor a failure. */
  skipped: number
}

export interface TapResult {
  tests: TapTest[]
  /** From the plan line ('1..N'). Undefined if no plan line was found. */
  planCount?: number
  /** Text after 'Bail out!'. Undefined if the run did not bail out. */
  bailOutReason?: string
  counts: TapCounts
}

const PLAN_LINE = /^1\.\.(\d+)\b/
const TEST_LINE = /^(not\s+)?ok\b\s*(\d+)?\s*(.*)$/
const BAIL_LINE = /^Bail out!\s*(.*)$/
// An unescaped '#' introduces a directive. TAP escapes a literal '#' in a
// description as '\#', so an escaped hash never starts one.
const DIRECTIVE = /(?<!\\)#\s*(SKIP|TODO)\b\s*(.*)$/i

/**
 * Parses nf-test's TAP output. Ignores any line that is not a plan line, a
 * test result line, or a bail-out line, so nf-test's own log lines under
 * '--verbose' (interleaved with the TAP stream) do not break parsing.
 *
 * Stops at 'Bail out!': nf-test gave up mid-run, so anything after it is not
 * reliable TAP and must not be counted.
 */
export function parseTap(output: string): TapResult {
  const tests: TapTest[] = []
  let planCount: number | undefined
  let bailOutReason: string | undefined
  let passed = 0
  let failed = 0
  let todo = 0
  let skip = 0

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const bail = BAIL_LINE.exec(line)
    if (bail) {
      bailOutReason = bail[1] ?? ''
      break
    }

    const plan = PLAN_LINE.exec(line)
    if (plan) {
      planCount = Number(plan[1])
      continue
    }

    const test = TEST_LINE.exec(line)
    if (test) {
      const isNotOk = test[1] !== undefined
      const number = test[2] !== undefined ? Number(test[2]) : undefined
      let rest = (test[3] ?? '').replace(/^-\s*/, '')

      // A TODO test is an expected failure: it never counts as a failure,
      // whether it reports ok or not ok. A SKIP test is neither a pass nor
      // a failure. Both cases override the plain ok/not-ok status.
      let status: TapStatus = isNotOk ? 'fail' : 'pass'
      const directive = DIRECTIVE.exec(rest)
      if (directive) {
        rest = rest.slice(0, directive.index).trim()
        status = directive[1]?.toUpperCase() === 'TODO' ? 'todo' : 'skip'
      }
      // '\#' is TAP's escape for a literal '#' in a description.
      rest = rest.replace(/\\#/g, '#')

      if (status === 'pass') passed++
      else if (status === 'fail') failed++
      else if (status === 'todo') todo++
      else skip++

      tests.push({ number, description: rest, status })
    }
  }

  return {
    tests,
    planCount,
    bailOutReason,
    counts: {
      total: tests.length,
      passed,
      failed,
      todo,
      skip,
      skipped: todo + skip
    }
  }
}
