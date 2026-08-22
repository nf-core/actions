import * as core from '@actions/core'
import { escapeHtml } from '../../lib/escape-html.js'
import { assertPositiveInteger } from '../../lib/positive-integer.js'
import { isReleaseBranch } from '../../lib/release-branch.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import {
  hasWritePermission,
  latestBaseRefChangedAt,
  listReviews
} from './api.js'
import {
  approvedLogins,
  decideApprovalGate,
  latestDecisionsBefore,
  resolveRevision
} from './decide.js'

interface Inputs {
  eventName: string
  token: string
  owner: string
  repo: string
  sha: string
  requiredApprovals: number
  // Present, and checked, only for the pull_request_review event.
  reviewState: string
  reviewUser: string
  reviewId: number
  prNumber: number
  prAuthor: string
  baseRef: string
}

/** Fails loudly, naming the missing input, rather than letting a blank value silently fail an API call further down. */
function requireForReviewEvent(name: string, value: string): void {
  if (value.trim() === '') {
    throw new Error(
      `Input '${name}' is required for the pull_request_review event, but was empty. The workflow calling this action must pass 'github.event.review.*' and 'github.event.pull_request.*' fields.`
    )
  }
}

function readInputs(): Inputs {
  const eventName = core.getInput('event-name', { required: true })
  const repository = core.getInput('repository', { required: true })
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(
      `Input 'repository' must be 'owner/repo'. Got: ${JSON.stringify(repository)}`
    )
  }

  const requiredApprovalsRaw = core.getInput('required-approvals', {
    required: true
  })
  const requiredApprovals = Number(requiredApprovalsRaw)
  assertPositiveInteger(requiredApprovals, "Input 'required-approvals'")

  const reviewState = core.getInput('review-state')
  const reviewUser = core.getInput('review-user')
  const reviewIdRaw = core.getInput('review-id')
  const prNumberRaw = core.getInput('pr-number')
  const prAuthor = core.getInput('pr-author')
  const baseRef = core.getInput('base-ref')

  if (eventName === 'pull_request_review') {
    requireForReviewEvent('review-state', reviewState)
    requireForReviewEvent('review-user', reviewUser)
    requireForReviewEvent('review-id', reviewIdRaw)
    requireForReviewEvent('pr-number', prNumberRaw)
    requireForReviewEvent('pr-author', prAuthor)
    requireForReviewEvent('base-ref', baseRef)
  }

  const reviewId = Number(reviewIdRaw || '0')
  const prNumber = Number(prNumberRaw || '0')
  if (eventName === 'pull_request_review') {
    assertPositiveInteger(reviewId, "Input 'review-id'")
    assertPositiveInteger(prNumber, "Input 'pr-number'")
  }

  return {
    eventName,
    token: core.getInput('github-token', { required: true }),
    owner,
    repo,
    sha: core.getInput('sha', { required: true }),
    requiredApprovals,
    reviewState,
    reviewUser,
    reviewId,
    prNumber,
    prAuthor,
    baseRef
  }
}

function setOutputs(shouldRun: boolean, revision: string): void {
  core.setOutput('should-run', shouldRun ? 'true' : 'false')
  core.setOutput('revision', shouldRun ? revision : '')
}

function writeSummary(
  shouldRun: boolean,
  reason: string,
  revision: string,
  // Omitted when decideApprovalGate() was never reached (an earlier,
  // unconditional check already decided the outcome), so there is no
  // approval count to report.
  approvals?: { before: number; required: number }
): Promise<void> {
  core.summary.addHeading('authorize-launch', 3).addTable([
    [
      { data: 'Setting', header: true },
      { data: 'Value', header: true }
    ],
    ['Should run', shouldRun ? 'true' : 'false'],
    // Untrusted: composed from pull-request-controlled logins in decide.ts's
    // own reason strings on some paths (a reviewer or the pull request
    // author's login).
    ['Reason', escapeHtml(reason)],
    ['Revision', shouldRun ? escapeHtml(revision) : '(not launching)'],
    ...(approvals
      ? [
          [
            'Trusted approvals before this one',
            `${String(approvals.before)} of ${String(approvals.required)}`
          ]
        ]
      : [])
  ])
  return writeSummaryBestEffort()
}

/**
 * Decides whether to launch the AWS full test for this run, and, when it
 * does, which revision to launch. Never checks out anything and never runs
 * pull request code: every decision here comes from the GitHub API and the
 * triggering event's own metadata.
 */
export async function run(): Promise<void> {
  const inputs = readInputs()

  // A manual dispatch or a published release is already maintainer-gated by
  // GitHub itself (dispatching needs write access; publishing a release
  // needs write access), so neither needs the approval count below.
  if (
    inputs.eventName === 'workflow_dispatch' ||
    inputs.eventName === 'release'
  ) {
    const revision = resolveRevision(inputs.eventName, inputs.sha)
    core.info(`authorize-launch: '${inputs.eventName}' always launches.`)
    setOutputs(true, revision)
    await writeSummary(true, `Triggered by '${inputs.eventName}'.`, revision)
    return
  }

  if (inputs.eventName !== 'pull_request_review') {
    // This job runs unconditionally for every event the workflow can be
    // called for (see awsfulltest.yml): an event beyond the three this
    // action knows about must fail loudly, not silently launch nothing and
    // report success.
    throw new Error(
      `authorize-launch only supports 'workflow_dispatch', 'release', and 'pull_request_review', but this run was triggered by '${inputs.eventName}'.`
    )
  }

  // The webhook payload's own casing (see decide.ts's own note): only a
  // submitted, state 'approved' review can ever be the one that crosses the
  // threshold. A request-changes, comment, or dismissal is never itself the
  // triggering review for a launch, whatever it does to an earlier count.
  if (inputs.reviewState !== 'approved') {
    core.info(
      `authorize-launch: review state is '${inputs.reviewState}', not 'approved'.`
    )
    setOutputs(false, '')
    await writeSummary(false, `Review state is '${inputs.reviewState}'.`, '')
    return
  }

  if (!isReleaseBranch(inputs.baseRef)) {
    const reason = `Base branch '${inputs.baseRef}' is not a release branch (main/master); the full-test gate does not apply.`
    core.info(`authorize-launch: ${reason}`)
    setOutputs(false, '')
    await writeSummary(false, reason, '')
    return
  }

  // Checked before any API call, mirroring the reasoning in
  // decideApprovalGate(): GitHub itself refuses to let a pull request's
  // author approve their own pull request, but this is a cheap, defensive
  // check that costs nothing if that ever changes.
  if (inputs.reviewUser === inputs.prAuthor) {
    const reason =
      'The reviewer is the pull request author. A self-approval never counts.'
    core.info(`authorize-launch: ${reason}`)
    setOutputs(false, '')
    await writeSummary(false, reason, '')
    return
  }

  // Checking the current reviewer first, before listing every review, is
  // both an optimisation (skips the list call for the common case: a
  // reviewer without write access) and the same order the review was
  // actually made in: their own permission decides whether their approval
  // could ever count, independent of anyone else's.
  const reviewerTrusted = await hasWritePermission(
    inputs.token,
    inputs.owner,
    inputs.repo,
    inputs.reviewUser
  )
  if (!reviewerTrusted) {
    const reason = `${inputs.reviewUser} does not have write permission on ${inputs.owner}/${inputs.repo}.`
    core.info(`authorize-launch: ${reason}`)
    setOutputs(false, '')
    await writeSummary(false, reason, '')
    return
  }

  // Fetched together: neither depends on the other's result.
  const [reviews, baseChangedAt] = await Promise.all([
    listReviews(inputs.token, inputs.owner, inputs.repo, inputs.prNumber),
    latestBaseRefChangedAt(
      inputs.token,
      inputs.owner,
      inputs.repo,
      inputs.prNumber
    )
  ])
  const decisions = latestDecisionsBefore(
    reviews,
    inputs.reviewId,
    inputs.prAuthor,
    baseChangedAt
  )

  // Only a login with a prior 'APPROVED' decision needs its permission
  // checked: a commenter or a requester-of-changes can never contribute to
  // the trusted count, whatever their own permission is.
  const trustedLogins = new Set<string>([inputs.reviewUser])
  for (const login of approvedLogins(decisions)) {
    if (login === inputs.reviewUser) continue
    if (
      await hasWritePermission(inputs.token, inputs.owner, inputs.repo, login)
    ) {
      trustedLogins.add(login)
    }
  }

  const result = decideApprovalGate({
    reviews,
    currentReviewId: inputs.reviewId,
    currentReviewerLogin: inputs.reviewUser,
    prAuthorLogin: inputs.prAuthor,
    requiredApprovals: inputs.requiredApprovals,
    trustedLogins,
    baseChangedAt
  })

  const revision = resolveRevision(inputs.eventName, inputs.sha)
  core.info(
    `authorize-launch: ${result.reason} should-run=${String(result.shouldRun)}`
  )
  setOutputs(result.shouldRun, revision)
  await writeSummary(result.shouldRun, result.reason, revision, {
    before: result.trustedApprovalsBefore,
    required: inputs.requiredApprovals
  })
}
