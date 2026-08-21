import * as core from '@actions/core'
import { encodeOutput } from '../../lib/encode-output.js'
import { getInputOrDefault } from '../../lib/optional-input.js'
import { DEFAULT_CHANGED_SINCE, runNfTest } from '../../lib/run-nf-test.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import {
  buildArgs,
  DEFAULT_PROFILE,
  parseMaxShards,
  type DryRunInputs
} from './args.js'
import { parseDryRunOutput } from './parse.js'

interface Inputs extends DryRunInputs {
  maxShards: number
}

function readInputs(): Inputs {
  return {
    maxShards: parseMaxShards(core.getInput('max-shards', { required: true })),
    profile: core.getInput('profile') || DEFAULT_PROFILE,
    tags: core.getInput('tags'),
    changedSince: getInputOrDefault('changed-since', DEFAULT_CHANGED_SINCE)
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

  const { stdout, stderr, exitCode } = await runNfTest(args)

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
