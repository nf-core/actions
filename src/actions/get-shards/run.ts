import * as core from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { which } from '@actions/io'
import { encodeOutput } from '../../lib/encode-output.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import {
  buildArgs,
  DEFAULT_CHANGED_SINCE,
  DEFAULT_PROFILE,
  parseMaxShards,
  type DryRunInputs
} from './args.js'
import { parseDryRunOutput } from './parse.js'

const NFTEST_NOT_ON_PATH =
  'nf-test is not on PATH. The calling workflow must install it before this action runs, for example with nf-core/setup-nf-test.'

interface Inputs extends DryRunInputs {
  maxShards: number
}

function readInputs(): Inputs {
  return {
    maxShards: parseMaxShards(core.getInput('max-shards', { required: true })),
    profile: core.getInput('profile') || DEFAULT_PROFILE,
    tags: core.getInput('tags'),
    changedSince: core.getInput('changed-since') || DEFAULT_CHANGED_SINCE
  }
}

function writeSummary(
  testCount: number,
  shardCount: number,
  maxShards: number
): Promise<void> {
  core.summary
    .addHeading('get-shards: shard plan', 3)
    .addRaw(
      `nf-test would run ${String(testCount)} test(s). Using ${String(shardCount)} shard(s) (cap: ${String(maxShards)}).`,
      true
    )
  return writeSummaryBestEffort()
}

/** Runs nf-test's dry run, parses the test count, and publishes the shard matrix. */
export async function run(): Promise<void> {
  const inputs = readInputs()
  const args = buildArgs(inputs)

  // which()'s `check` argument defaults to false: it returns '' instead of
  // throwing when nf-test is not on PATH.
  if ((await which('nf-test')) === '') {
    throw new Error(NFTEST_NOT_ON_PATH)
  }

  // JSON-encode the args before logging: it renders a newline in an
  // untrusted tags/changed-since value as the two characters \n, so the
  // value can't inject a workflow command into the log.
  core.info(`Running: nf-test ${JSON.stringify(args)}`)

  // silent: true stops @actions/exec echoing its own unencoded "[command]
  // nf-test <args>" line, which would otherwise reopen the same injection
  // the JSON-encoded log line above closes. getExecOutput still captures
  // stdout and stderr below regardless of this option.
  const { stdout, stderr, exitCode } = await getExecOutput('nf-test', args, {
    ignoreReturnCode: true,
    silent: true
  })

  if (exitCode !== 0) {
    throw new Error(
      `nf-test exited with code ${String(exitCode)}. Output:\n${stdout}${stderr}`
    )
  }

  const testCount = parseDryRunOutput(stdout)
  const shardCount = Math.min(testCount, inputs.maxShards)
  const shards = Array.from({ length: shardCount }, (_, i) => i + 1)

  if (testCount === 0) {
    core.info('No related tests found.')
  } else {
    core.info(
      `Found ${String(testCount)} test(s). Using ${String(shardCount)} shard(s).`
    )
  }

  core.setOutput('shards', encodeOutput(shards))
  core.setOutput('total-shards', encodeOutput(shardCount))
  core.setOutput('has-tests', encodeOutput(testCount > 0))

  await writeSummary(testCount, shardCount, inputs.maxShards)
}
