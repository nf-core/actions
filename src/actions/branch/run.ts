import * as core from '@actions/core'
import { escapeHtml } from '../../lib/escape-html.js'
import { assertPositiveInteger } from '../../lib/positive-integer.js'
import { isReleaseBranch } from '../../lib/release-branch.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import { writeArtifact } from './artifact.js'
import { buildComment } from './comment.js'
import { isAllowedSource } from './decide.js'

const DEFAULT_ARTIFACT_DIR = 'pr-comment'

type Result = 'allowed' | 'blocked' | 'not-applicable'

interface Inputs {
  eventName: string
  headRepo: string
  headRef: string
  baseRef: string
  canonicalRepo: string
  prUser: string
  prNumber: number
  artifactDir: string
}

/**
 * The job that calls this action runs unconditionally (see branch.yml): a
 * skipped required status check counts as passed, silently removing branch
 * protection instead of enforcing it. So an unexpected event fails loudly
 * here instead.
 */
function assertPullRequestEvent(eventName: string): void {
  if (eventName !== 'pull_request') {
    throw new Error(
      `branch.yml only supports the 'pull_request' event, but this run was triggered by '${eventName}'. The pipeline's stub must trigger 'on: pull_request'.`
    )
  }
}

function readInputs(): Inputs {
  const eventName = core.getInput('event-name', { required: true })
  assertPullRequestEvent(eventName)

  const prNumberRaw = core.getInput('pr-number', { required: true })
  const prNumber = Number(prNumberRaw)
  assertPositiveInteger(prNumber, "Input 'pr-number'")

  return {
    eventName,
    headRepo: core.getInput('head-repo', { required: true }),
    headRef: core.getInput('head-ref', { required: true }),
    baseRef: core.getInput('base-ref', { required: true }),
    canonicalRepo: core.getInput('repository', { required: true }),
    prUser: core.getInput('pr-user', { required: true }),
    prNumber,
    artifactDir: core.getInput('artifact-path') || DEFAULT_ARTIFACT_DIR
  }
}

function writeSummary(
  result: Result,
  baseRef: string,
  headRepo: string,
  headRef: string
): Promise<void> {
  core.summary.addHeading('branch: source check', 3).addTable([
    [
      { data: 'Setting', header: true },
      { data: 'Value', header: true }
    ],
    ['Base branch', escapeHtml(baseRef)],
    // Both values are pull-request-controlled (a contributor's own fork
    // name and branch name): escape before this table, which addTable()
    // writes as raw, unescaped HTML.
    ['Head repository', escapeHtml(headRepo)],
    ['Head branch', escapeHtml(headRef)],
    ['Result', result]
  ])
  return writeSummaryBestEffort()
}

/**
 * Decides whether a pull request's source branch is one this pipeline's
 * release branch accepts, and writes the 'pr-comment' artifact: a comment
 * only when it is not. Never posts anything itself; a separate, privileged
 * workflow does that from the artifact this produces. Fails the action
 * itself when the source is not allowed, independent of whether that
 * artifact is ever posted: this is the check branch protection reads.
 *
 * Writes no resolved.md: a pull request's head repository, head branch and
 * canonical repository are fixed for its whole life, so a blocked
 * decision here can never later flip to allowed on the same pull request.
 * See writeArtifact()'s own doc comment and README.md.
 */
export async function run(): Promise<void> {
  const inputs = readInputs()

  if (!isReleaseBranch(inputs.baseRef)) {
    core.info(
      `branch: base=${JSON.stringify(inputs.baseRef)} is not a release branch (main/master); the source check does not apply.`
    )
    writeArtifact(inputs.artifactDir, String(inputs.prNumber))
    await writeSummary(
      'not-applicable',
      inputs.baseRef,
      inputs.headRepo,
      inputs.headRef
    )
    return
  }

  const allowed = isAllowedSource({
    headRepo: inputs.headRepo,
    headRef: inputs.headRef,
    canonicalRepo: inputs.canonicalRepo
  })

  // JSON-encoded: headRepo and headRef are pull-request-controlled, so a
  // value containing a newline can't inject a workflow command into the log
  // (same reasoning as read-config's own resolved-value log line).
  core.info(
    `branch: head=${JSON.stringify(inputs.headRepo)}:${JSON.stringify(inputs.headRef)} canonical=${JSON.stringify(inputs.canonicalRepo)} result=${allowed ? 'allowed' : 'blocked'}`
  )

  const comment = allowed
    ? undefined
    : buildComment(inputs.baseRef, inputs.canonicalRepo, inputs.prUser)

  writeArtifact(inputs.artifactDir, String(inputs.prNumber), comment)

  await writeSummary(
    allowed ? 'allowed' : 'blocked',
    inputs.baseRef,
    inputs.headRepo,
    inputs.headRef
  )

  if (!allowed) {
    throw new Error(
      `Pull request #${String(inputs.prNumber)} targets '${inputs.baseRef}' from '${inputs.headRepo}:${inputs.headRef}'. Only '${inputs.canonicalRepo}:dev' or '${inputs.canonicalRepo}:patch' may target '${inputs.baseRef}'.`
    )
  }
}
