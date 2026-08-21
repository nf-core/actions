import { describe, expect, it } from '@jest/globals'
import { parseTap } from '../../src/actions/nf-test/tap.js'

const ALL_PASSING = `
🚀 nf-test 0.9.2
https://code.askimed.com/nf-test

Test Directory: /home/runner/work/rnaseq/rnaseq/tests

TAP version 13
1..3
ok 1 - PIPELINE: Should run without failures
ok 2 - PIPELINE: Should run with fasta
ok 3 - PIPELINE: Should run with gtf

Finished in 12.3s
`

const MIX_WITH_FAILURE = `
TAP version 13
1..3
ok 1 - PIPELINE: Should run without failures
not ok 2 - PIPELINE: Should run with fasta
ok 3 - PIPELINE: Should run with gtf
`

const WITH_SKIPPED = `
1..3
ok 1 - PIPELINE: Should run without failures
ok 2 - PIPELINE: Should run with fasta # SKIP no fasta available
ok 3 - PIPELINE: Should run with gtf
`

const WITH_TODO = `
1..2
not ok 1 - PIPELINE: Known-broken edge case # TODO fix upstream bug
ok 2 - PIPELINE: Should run with gtf
`

const WITH_BAIL_OUT = `
1..3
ok 1 - PIPELINE: Should run without failures
Bail out! Nextflow crashed with exit code 1
`

const PLAN_MISMATCH = `
1..5
ok 1 - PIPELINE: Should run without failures
ok 2 - PIPELINE: Should run with fasta
`

describe('parseTap', () => {
  it('parses a realistic all-passing run, tolerating interleaved log lines', () => {
    const result = parseTap(ALL_PASSING)
    expect(result.planCount).toBe(3)
    expect(result.bailOutReason).toBeUndefined()
    expect(result.tests).toEqual([
      {
        number: 1,
        description: 'PIPELINE: Should run without failures',
        status: 'pass'
      },
      {
        number: 2,
        description: 'PIPELINE: Should run with fasta',
        status: 'pass'
      },
      {
        number: 3,
        description: 'PIPELINE: Should run with gtf',
        status: 'pass'
      }
    ])
    expect(result.counts).toEqual({
      total: 3,
      passed: 3,
      failed: 0,
      todo: 0,
      skip: 0,
      skipped: 0
    })
  })

  it('parses a mix with a failure', () => {
    const result = parseTap(MIX_WITH_FAILURE)
    expect(result.tests[1]).toEqual({
      number: 2,
      description: 'PIPELINE: Should run with fasta',
      status: 'fail'
    })
    expect(result.counts).toEqual({
      total: 3,
      passed: 2,
      failed: 1,
      todo: 0,
      skip: 0,
      skipped: 0
    })
  })

  it('parses a SKIP directive as skipped, not a failure', () => {
    const result = parseTap(WITH_SKIPPED)
    expect(result.tests[1]).toEqual({
      number: 2,
      description: 'PIPELINE: Should run with fasta',
      status: 'skip'
    })
    expect(result.counts).toEqual({
      total: 3,
      passed: 2,
      failed: 0,
      todo: 0,
      skip: 1,
      skipped: 1
    })
  })

  it('parses a TODO directive as expected, not a failure, even when it reports not ok', () => {
    const result = parseTap(WITH_TODO)
    expect(result.tests[0]).toEqual({
      number: 1,
      description: 'PIPELINE: Known-broken edge case',
      status: 'todo'
    })
    expect(result.counts).toEqual({
      total: 2,
      passed: 1,
      failed: 0,
      todo: 1,
      skip: 0,
      skipped: 1
    })
  })

  it('records a Bail out! reason and stops parsing: later ok lines are not counted', () => {
    const result = parseTap(
      `${WITH_BAIL_OUT}ok 2 - should not be counted\nok 3 - should not be counted either\n`
    )
    expect(result.bailOutReason).toBe('Nextflow crashed with exit code 1')
    expect(result.tests).toHaveLength(1)
    expect(result.counts.total).toBe(1)
  })

  // A plan line promising more tests than were reported means the run was
  // cut short. parseTap() reports only what was actually seen; run.ts
  // treats planCount !== counts.total as a failure on top of that, because
  // a truncated run must not look like a clean pass.
  it('reports only the tests actually seen when the plan count is higher, leaving the mismatch for the caller to detect', () => {
    const result = parseTap(PLAN_MISMATCH)
    expect(result.planCount).toBe(5)
    expect(result.tests).toHaveLength(2)
    expect(result.counts.total).toBe(2)
  })

  it('ignores lines that are not plan, test-result, or bail-out lines', () => {
    const result = parseTap(
      'some random log line\n1..1\nok 1 - test\nanother log line'
    )
    expect(result.tests).toHaveLength(1)
    expect(result.planCount).toBe(1)
  })

  it('records an empty bail-out reason when no text follows "Bail out!"', () => {
    const result = parseTap('1..1\nok 1 - test\nBail out!')
    expect(result.bailOutReason).toBe('')
  })

  it('parses a test line with no test number', () => {
    const result = parseTap('ok - description without a number')
    expect(result.tests).toEqual([
      {
        number: undefined,
        description: 'description without a number',
        status: 'pass'
      }
    ])
  })

  it('returns an empty result for empty input', () => {
    const result = parseTap('')
    expect(result.tests).toHaveLength(0)
    expect(result.planCount).toBeUndefined()
    expect(result.bailOutReason).toBeUndefined()
    expect(result.counts).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      todo: 0,
      skip: 0,
      skipped: 0
    })
  })

  describe('directive escaping', () => {
    it('does not treat the plain words SKIP and TODO mid-sentence as a directive', () => {
      const result = parseTap(
        'not ok 1 - Should reject SKIP and TODO options in the config'
      )
      expect(result.tests[0]).toEqual({
        number: 1,
        description: 'Should reject SKIP and TODO options in the config',
        status: 'fail'
      })
      expect(result.counts).toEqual({
        total: 1,
        passed: 0,
        failed: 1,
        todo: 0,
        skip: 0,
        skipped: 0
      })
    })

    it('honours an escaped \\# as a literal character, not a directive', () => {
      const result = parseTap(
        'not ok 1 - Errors on a config with a literal \\# TODO marker'
      )
      expect(result.tests[0]).toEqual({
        number: 1,
        description: 'Errors on a config with a literal # TODO marker',
        status: 'fail'
      })
      expect(result.counts.failed).toBe(1)
      expect(result.counts.skipped).toBe(0)
    })

    it('still recognises a real trailing directive after an escaped hash earlier in the line', () => {
      const result = parseTap(
        'not ok 1 - Handles a literal \\# in config # TODO fix upstream bug'
      )
      expect(result.tests[0]).toEqual({
        number: 1,
        description: 'Handles a literal # in config',
        status: 'todo'
      })
      expect(result.counts.failed).toBe(0)
      expect(result.counts.todo).toBe(1)
    })
  })
})
