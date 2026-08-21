import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '@actions/core'
import { encodeOutput } from '../../lib/encode-output.js'
import { getInputOrDefault } from '../../lib/optional-input.js'
import { DEFAULT_CHANGED_SINCE, runNfTest } from '../../lib/run-nf-test.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import {
  assertProfile,
  assertShardWithinTotal,
  buildArgs,
  parseExtraArgs,
  parseShardNumber,
  parseVerbose,
  type NfTestInputs
} from './args.js'
import {
  parseTap,
  type TapCounts,
  type TapResult,
  type TapStatus
} from './tap.js'

function readInputs(): NfTestInputs {
  const profile = core.getInput('profile', { required: true })
  assertProfile(profile)

  const shard = parseShardNumber(
    core.getInput('shard', { required: true }),
    'shard'
  )
  const totalShards = parseShardNumber(
    core.getInput('total-shards', { required: true }),
    'total-shards'
  )
  assertShardWithinTotal(shard, totalShards)

  return {
    profile,
    shard,
    totalShards,
    tags: core.getInput('tags'),
    changedSince: getInputOrDefault('changed-since', DEFAULT_CHANGED_SINCE),
    verbose: parseVerbose(core.getInput('verbose')),
    extraArgs: parseExtraArgs(core.getInput('extra-args'))
  }
}

// Node's fs errors always carry a string .code, regardless of which realm
// constructed them. Checking that shape, rather than `instanceof Error`,
// avoids a cross-realm false negative under Jest's experimental VM modules.
function isEnoent(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

/**
 * Reads the TAP file nf-test wrote. Empty string if nf-test crashed before
 * writing it at all: that is a "no parseable TAP" condition, not a crash of
 * this action.
 */
function readTapFile(tapPath: string): string {
  try {
    return readFileSync(tapPath, 'utf8')
  } catch (error) {
    if (isEnoent(error)) return ''
    throw error
  }
}

const STATUS_ICON: Record<TapStatus, string> = {
  pass: '✅',
  fail: '❌',
  skip: '⏭️',
  todo: '📝'
}

/** Escapes text for a job summary table cell. addTable() writes cell data as raw HTML, unescaped. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function writeSummary(
  parsed: TapResult,
  counts: TapCounts,
  inputs: NfTestInputs
): Promise<void> {
  core.summary
    .addHeading('nf-test results', 3)
    .addRaw(
      `${String(counts.passed)} passed, ${String(counts.failed)} failed, ${String(counts.skipped)} skipped, ${String(counts.total)} total.`,
      true
    )
    .addTable([
      [
        { data: 'Status', header: true },
        { data: 'Test', header: true },
        { data: 'Profile', header: true },
        { data: 'Shard', header: true }
      ],
      ...parsed.tests.map((test) => [
        STATUS_ICON[test.status],
        escapeHtml(test.description || `#${String(test.number ?? '?')}`),
        inputs.profile,
        `${String(inputs.shard)}/${String(inputs.totalShards)}`
      ])
    ])
  return writeSummaryBestEffort()
}

/** Runs one nf-test shard, parses its TAP output, and reports the result. */
export async function run(): Promise<void> {
  const inputs = readInputs()

  // A temp directory the action controls, not the working directory: this
  // action does not own the working directory's lifecycle or contents.
  const tapDir = await mkdtemp(join(tmpdir(), 'nf-test-'))
  const tapPath = join(tapDir, 'test.tap')
  const args = buildArgs(inputs, tapPath)

  const { stdout, stderr, exitCode } = await runNfTest(args)

  const parsed = parseTap(readTapFile(tapPath))
  const counts = parsed.counts

  // A run that tests nothing must never look like a pass, whatever nf-test's
  // exit code was: there is no legitimate zero-test path. get-shards caps
  // the shard count at the number of tests it found, and its has-tests
  // output stops the matrix job from starting at all when there are none.
  // A shard that reaches this point with zero tests means something is
  // broken upstream (for example a config error or a renamed nf-test flag),
  // not an empty shard that should be allowed to pass.
  if (counts.total === 0) {
    throw new Error(
      `nf-test reported zero tests (exit code ${String(exitCode)}). A run that tests nothing is always treated as a failure. Output:\n${stdout}${stderr}`
    )
  }

  core.setOutput('total', encodeOutput(counts.total))
  core.setOutput('passed', encodeOutput(counts.passed))
  core.setOutput('failed', encodeOutput(counts.failed))
  core.setOutput('todo', encodeOutput(counts.todo))
  core.setOutput('skip', encodeOutput(counts.skip))
  core.setOutput('skipped', encodeOutput(counts.skipped))
  core.setOutput('tap-path', tapPath)
  core.setOutput('exit-code', encodeOutput(exitCode))
  core.setOutput('bailed-out', encodeOutput(parsed.bailOutReason !== undefined))

  await writeSummary(parsed, counts, inputs)

  const problems: string[] = []
  if (parsed.bailOutReason !== undefined) {
    problems.push(
      `nf-test bailed out: ${parsed.bailOutReason || '(no reason given)'}`
    )
  }
  // The plan line promised more tests than were reported: the run was cut
  // short, for example by a crash mid-suite. Treat that as a failure.
  // Silently accepting the executed subset would hide the missing tests,
  // the same reasoning as the "no parseable TAP" check above.
  if (parsed.planCount !== undefined && parsed.planCount !== counts.total) {
    problems.push(
      `nf-test's plan announced ${String(parsed.planCount)} test(s) but only ${String(counts.total)} were reported.`
    )
  }
  if (counts.failed > 0) {
    problems.push(
      `${String(counts.failed)} of ${String(counts.total)} test(s) failed.`
    )
  }
  if (exitCode !== 0) {
    problems.push(`nf-test exited with code ${String(exitCode)}.`)
  }

  // Include the captured output on the failure path: it carries nf-test's
  // own diagnostics (a Nextflow stack trace, an error report path). Safe to
  // throw unescaped here, unlike core.info: core.setFailed() (via
  // runAction) reports it through core.error(), which escapes it.
  if (problems.length > 0) {
    throw new Error(`${problems.join(' ')} Output:\n${stdout}${stderr}`)
  }
}
