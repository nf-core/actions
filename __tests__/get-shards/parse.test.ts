import { describe, expect, it } from '@jest/globals'
import { parseDryRunOutput } from '../../src/actions/get-shards/parse.js'

const dryRunWithTests = `
🚀 nf-test 0.9.2
https://code.askimed.com/nf-test

Loading .nf-test/plugins/nft-utils@0.0.3/main.nf.test.config
Test Directory: /home/runner/work/rnaseq/rnaseq/tests

  Test [a1b2c3d4] 'Should run without failures' - SKIPPED (DRY-RUN)
  Test [e5f6a7b8] 'Should run with fasta' - SKIPPED (DRY-RUN)
  Test [c9d0e1f2] 'Should run with gtf' - SKIPPED (DRY-RUN)

Executed 3 tests in 12ms
`

const dryRunNoTests = `
🚀 nf-test 0.9.2
https://code.askimed.com/nf-test

Loading .nf-test/plugins/nft-utils@0.0.3/main.nf.test.config
Test Directory: /home/runner/work/rnaseq/rnaseq/tests

No tests to execute.
`

const dryRunExplicitZero = `
🚀 nf-test 0.9.2
https://code.askimed.com/nf-test

Executed 0 tests in 3ms
`

describe('parseDryRunOutput', () => {
  it('reads the test count out of a realistic multi-line dry-run', () => {
    expect(parseDryRunOutput(dryRunWithTests)).toBe(3)
  })

  it('reads a single test as a count of 1', () => {
    expect(
      parseDryRunOutput('some log line\nExecuted 1 tests in 1ms\nsome trailer')
    ).toBe(1)
  })

  it('treats "No tests to execute" as a count of zero, not a parse failure', () => {
    expect(parseDryRunOutput(dryRunNoTests)).toBe(0)
  })

  it('treats an explicit "Executed 0 tests" the same as "No tests to execute"', () => {
    expect(parseDryRunOutput(dryRunExplicitZero)).toBe(0)
  })

  it('fails loudly on output matching neither shape, including the output in the message', () => {
    const weirdOutput = 'nf-test crashed with a stack trace\nnope, nothing here'
    expect(() => parseDryRunOutput(weirdOutput)).toThrow(
      new RegExp(weirdOutput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    )
  })

  it('never falls back to zero shards on unparseable output', () => {
    expect(() => parseDryRunOutput('totally unexpected output')).toThrow()
  })
})
