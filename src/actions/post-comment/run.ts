import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { escapeHtml } from '../../lib/escape-html.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import { readArtifact } from './artifact.js'
import { buildCommentBody } from './body.js'
import { buildMarker } from './marker.js'
import { sanitiseBody } from './sanitise.js'
import { validateHeader, validatePrNumber } from './validate.js'

type Octokit = ReturnType<typeof getOctokit>

// What every comment GITHUB_TOKEN itself posts under, whatever repository
// or installation it belongs to. Used only as the fallback below, for the
// one case GET /user cannot answer.
const GITHUB_ACTIONS_BOT_LOGIN = 'github-actions[bot]'

/**
 * Resolves the login the given token will post comments as, so a run
 * updates its own earlier comment however the calling workflow supplies
 * that token, instead of only ever matching one hardcoded login.
 *
 * GET /user needs a user-to-server token: it answers correctly for a
 * personal access token, but returns 403 for an installation access
 * token, which is what GITHUB_TOKEN and every other GitHub App token are.
 * That 403 is itself the reliable signal: GitHub Actions' own token always
 * posts as the fixed 'github-actions[bot]' login, so the fallback below
 * only ever triggers for the one token family it is correct for.
 */
async function resolveAuthenticatedLogin(octokit: Octokit): Promise<string> {
  try {
    const { data } = await octokit.rest.users.getAuthenticated()
    return data.login
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 403) return GITHUB_ACTIONS_BOT_LOGIN
    throw error
  }
}

interface Inputs {
  artifactPath: string
  token: string
  headSha: string
}

function readInputs(): Inputs {
  return {
    artifactPath: core.getInput('artifact-path', { required: true }),
    token: core.getInput('github-token', { required: true }),
    headSha: core.getInput('head-sha', { required: true })
  }
}

/**
 * Resolves which pull request(s) `headSha` belongs to, independent of
 * anything the artifact claims.
 *
 * github.event.workflow_run.pull_requests is not used for this: GitHub
 * leaves it empty whenever the run came from a pull request opened from a
 * fork, which is exactly the untrusted case this check exists for. Asking
 * the API for the commit's own associated pull requests instead works the
 * same way for a fork and for a same-repository branch, because GitHub
 * keys it by the commit itself, not by which repository holds the branch
 * it lives on.
 */
async function resolveAssociatedPrNumbers(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string
): Promise<number[]> {
  const pulls = await octokit.paginate(
    octokit.rest.repos.listPullRequestsAssociatedWithCommit,
    { owner, repo, commit_sha: headSha }
  )
  return pulls.map((pull) => pull.number)
}

/**
 * Finds a comment `selfLogin` itself posted that already starts with
 * `marker`, if any. Anchored on startsWith(), not includes(): buildMarker()
 * always writes the marker at position 0 (see body.ts), so a lookalike an
 * untrusted body buries elsewhere in someone else's comment can never match
 * here, even before sanitise.ts strips one out.
 */
async function findExistingCommentId(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  marker: string,
  selfLogin: string
): Promise<number | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber
  })
  return comments.find(
    (comment) =>
      comment.user?.login === selfLogin && comment.body?.startsWith(marker)
  )?.id
}

async function writeOutcomeSummary(
  header: string,
  prNumber: number,
  updated: boolean
): Promise<void> {
  core.summary
    .addHeading('post-comment', 3)
    .addRaw(
      `${updated ? 'Updated' : 'Created'} the '${escapeHtml(header)}' comment on pull request #${String(prNumber)}.`,
      true
    )
  await writeSummaryBestEffort()
}

/**
 * Posts or updates a pull request comment from a `pr-comment` artifact an
 * unprivileged workflow produced. Every field read from that artifact is
 * untrusted: this validates the header and the pull request number, then
 * verifies the pull request number independently before using it, and
 * never runs anything from the artifact as code.
 */
export async function run(): Promise<void> {
  const inputs = readInputs()

  const raw = readArtifact(inputs.artifactPath)
  if (!raw) {
    core.info(
      `No pr-comment artifact at '${inputs.artifactPath}'. Nothing to post.`
    )
    return
  }

  const header = validateHeader(raw.headerRaw)
  const prNumberClaim = validatePrNumber(raw.prNumberRaw)
  const { bodyRaw, resolvedRaw } = raw

  // A blank comment.md (present but empty, for example a lint run a
  // timeout killed after creating the file but before writing to it) means
  // the same thing as an absent one: nothing to say. Posting it would
  // otherwise overwrite a real earlier report with nothing.
  //
  // Neither a report nor a resolution: nothing to do, and (since there is
  // nothing that could change an existing comment either way) nothing to
  // check for one. Every producer that has never heard of resolved.md
  // keeps exactly today's fast no-op, with no API call at all.
  const commentAbsent = bodyRaw === undefined || bodyRaw.trim() === ''
  const resolvedAbsent = resolvedRaw === undefined || resolvedRaw.trim() === ''
  if (commentAbsent && resolvedAbsent) {
    core.info(
      `comment.md is absent or blank, and so is resolved.md (header '${header}'). Nothing to say.`
    )
    return
  }

  const octokit = getOctokit(inputs.token)
  const { owner, repo } = context.repo

  const associated = await resolveAssociatedPrNumbers(
    octokit,
    owner,
    repo,
    inputs.headSha
  )
  if (associated.length === 0) {
    core.info(
      `Commit ${inputs.headSha} is not associated with any open or merged pull request. Nothing to post.`
    )
    return
  }
  if (!associated.includes(prNumberClaim)) {
    throw new Error(
      `pr_number.txt claims pull request #${String(prNumberClaim)}, but commit ${inputs.headSha} is associated with pull request(s) ${associated.join(', ')}. Refusing to post to a pull request the triggering commit is not part of.`
    )
  }

  const selfLogin = await resolveAuthenticatedLogin(octokit)
  const marker = buildMarker(header)
  const existingId = await findExistingCommentId(
    octokit,
    owner,
    repo,
    prNumberClaim,
    marker,
    selfLogin
  )

  // comment.md, whenever present, always wins over resolved.md.
  if (bodyRaw !== undefined && bodyRaw.trim() !== '') {
    const body = buildCommentBody(marker, sanitiseBody(bodyRaw))
    if (existingId !== undefined) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingId,
        body
      })
      core.info(
        `Updated comment ${String(existingId)} on pull request #${String(prNumberClaim)} (header '${header}').`
      )
    } else {
      const created = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumberClaim,
        body
      })
      core.info(
        `Created comment ${String(created.data.id)} on pull request #${String(prNumberClaim)} (header '${header}').`
      )
    }
    await writeOutcomeSummary(header, prNumberClaim, existingId !== undefined)
    return
  }

  // comment.md is absent or blank here, so the guard above guarantees
  // resolved.md is not. It only ever updates an earlier comment, never
  // creates one: with nothing posted yet, there is nothing to resolve.
  if (existingId === undefined) {
    core.info(
      `resolved.md is present but no earlier '${header}' comment exists. Nothing to update.`
    )
    return
  }
  if (resolvedRaw === undefined || resolvedRaw.trim() === '') {
    return // Unreachable: ruled out by the guard above.
  }
  const body = buildCommentBody(marker, sanitiseBody(resolvedRaw))
  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: existingId,
    body
  })
  core.info(
    `Updated comment ${String(existingId)} on pull request #${String(prNumberClaim)} (header '${header}') to its resolved text.`
  )
  await writeOutcomeSummary(header, prNumberClaim, true)
}
