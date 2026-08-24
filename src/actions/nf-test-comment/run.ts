import * as core from '@actions/core'
import { assertPositiveInteger } from '../../lib/positive-integer.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import { writeArtifact } from './artifact.js'
import { buildComment, buildResolvedComment } from './comment.js'
import { readFragments } from './fragments.js'

const DEFAULT_ARTIFACT_DIR = 'pr-comment'

interface Inputs {
  fragmentsDir: string
  runUrl: string
  prNumber: number
  artifactDir: string
}

function readInputs(): Inputs {
  const prNumberRaw = core.getInput('pr-number', { required: true })
  const prNumber = Number(prNumberRaw)
  assertPositiveInteger(prNumber, "Input 'pr-number'")

  return {
    fragmentsDir: core.getInput('fragments-path', { required: true }),
    runUrl: core.getInput('run-url', { required: true }),
    prNumber,
    artifactDir: core.getInput('artifact-path') || DEFAULT_ARTIFACT_DIR
  }
}

function writeSummary(fragmentCount: number): Promise<void> {
  core.summary
    .addHeading('nf-test-comment', 3)
    .addRaw(
      fragmentCount > 0
        ? `${String(fragmentCount)} leg(s) failed against Nextflow's latest version.`
        : "No leg failed against Nextflow's latest version.",
      true
    )
  return writeSummaryBestEffort()
}

/**
 * Assembles the 'pr-comment' artifact reporting nf-test legs that failed
 * against Nextflow's floating 'latest' version, from the fragment files the
 * matrix job wrote (one per failed leg). Writes a comment only when at
 * least one fragment exists; writes resolved.md otherwise, so an earlier
 * failure comment is updated away once every leg passes again. Never posts
 * anything itself.
 */
export async function run(): Promise<void> {
  const inputs = readInputs()
  const fragments = readFragments(inputs.fragmentsDir)

  core.info(
    `nf-test-comment: ${String(fragments.length)} failed-leg fragment(s) found in '${inputs.fragmentsDir}'.`
  )

  const comment =
    fragments.length > 0 ? buildComment(fragments, inputs.runUrl) : undefined
  const resolved =
    fragments.length === 0 ? buildResolvedComment(inputs.runUrl) : undefined

  writeArtifact(inputs.artifactDir, String(inputs.prNumber), comment, resolved)

  await writeSummary(fragments.length)
}
