import * as core from '@actions/core'
import { escapeHtml } from '../../lib/escape-html.js'
import { assertPositiveInteger } from '../../lib/positive-integer.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import { writeArtifact } from './artifact.js'
import { buildComment, buildResolvedComment } from './comment.js'
import { fetchLatestToolsVersion } from './latest-release.js'
import { compareVersions, type Comparison } from './version.js'

const DEFAULT_ARTIFACT_DIR = 'pr-comment'

interface Inputs {
  /** The pipeline's configured nf-core/tools version, normally read-config's own 'nf-core-version' output. Empty string when unset. */
  pipelineVersion: string
  prNumber: number
  token: string
  artifactDir: string
}

function readInputs(): Inputs {
  const prNumberRaw = core.getInput('pr-number', { required: true })
  const prNumber = Number(prNumberRaw)
  assertPositiveInteger(prNumber, "Input 'pr-number'")

  return {
    pipelineVersion: core.getInput('nf-core-version'),
    prNumber,
    token: core.getInput('github-token', { required: true }),
    artifactDir: core.getInput('artifact-path') || DEFAULT_ARTIFACT_DIR
  }
}

function writeSummary(
  pipelineVersion: string,
  latestVersion: string,
  comparison: Comparison
): Promise<void> {
  core.summary.addHeading('template-version: comparison', 3).addTable([
    [
      { data: 'Setting', header: true },
      { data: 'Value', header: true }
    ],
    // Both values are file-sourced (a contributor's own .nf-core.yml on a
    // pull request) or an upstream release tag: escape before this table,
    // which addTable() writes as raw, unescaped HTML. Trimmed first, so a
    // whitespace-only value renders the same placeholder as an empty one
    // (compareVersions() already treats them the same way).
    ['Pipeline version', escapeHtml(pipelineVersion.trim() || '(not set)')],
    ['Latest nf-core/tools release', escapeHtml(latestVersion)],
    ['Result', comparison.status]
  ])
  return writeSummaryBestEffort()
}

/**
 * Compares the pipeline's configured template version against the latest
 * nf-core/tools release and writes the 'pr-comment' artifact: a comment
 * only when the pipeline is behind, nothing beyond pr_number.txt and
 * header.txt otherwise. Never posts anything itself; a separate, privileged
 * workflow does that from the artifact this produces.
 */
export async function run(): Promise<void> {
  const inputs = readInputs()
  const latestVersion = await fetchLatestToolsVersion(inputs.token)
  const comparison = compareVersions(inputs.pipelineVersion, latestVersion)

  // JSON-encoded: pipelineVersion is a contributor's own .nf-core.yml value
  // on a pull request, so a value containing a newline can't inject a
  // workflow command into the log (same reasoning as read-config's own
  // resolved-value log line).
  core.info(
    `nf-core-version: pipeline=${JSON.stringify(inputs.pipelineVersion)} latest=${JSON.stringify(latestVersion)} result=${comparison.status}`
  )

  let comment: string | undefined
  let resolved: string | undefined
  if (comparison.status === 'behind') {
    // comparison.pipelineVersion, not inputs.pipelineVersion: the coerced
    // form is digits and dots only, so nothing a pull request wrote into
    // .nf-core.yml beyond a version number can reach the posted comment.
    comment = buildComment(comparison.pipelineVersion, latestVersion)
  } else if (comparison.status === 'up-to-date') {
    // Lets post-comment update away an earlier 'behind' comment left over
    // from before this push. A no-op when there is no such comment: it
    // never creates one from resolved.md.
    resolved = buildResolvedComment(latestVersion)
  } else {
    core.warning(
      `Could not compare the pipeline's template version against the latest nf-core/tools release. ${comparison.reason}`
    )
  }

  writeArtifact(inputs.artifactDir, String(inputs.prNumber), comment, resolved)

  await writeSummary(inputs.pipelineVersion, latestVersion, comparison)
}
