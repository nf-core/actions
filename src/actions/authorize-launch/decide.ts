// Pure decision: does this pull request review event authorize launching
// the AWS full test? No I/O here; run.ts resolves reviewer permission and
// the review list through the API, then calls decideApprovalGate() with the
// result.
//
// State names below come from two different places and are cased
// differently on purpose:
//   - `review-state` on the triggering event (github.event.review.state) is
//     the webhook payload's own lowercase 'approved'.
//   - Every state inside `reviews` (the REST 'list reviews' response) is
//     GitHub's REST casing: 'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED',
//     'DISMISSED', 'PENDING'.
// Comparing the wrong one against the wrong casing would silently never
// match, so each is typed and compared separately below.

export interface Review {
  /** Review author's login. Absent on a deleted-user review; run.ts filters those out before this ever sees them. */
  login: string
  /** REST casing: 'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'. */
  state: string
  /** Review id. Ids increase monotonically, so comparing them orders reviews without trusting submission timestamps. */
  id: number
  /** ISO 8601 timestamp the review was submitted. Used to drop an approval given while the pull request targeted a different base branch. */
  submittedAt: string
}

/** A review in this state does not represent an approve/request-changes decision, so it must never overwrite an earlier one. */
const NON_DECIDING_STATES = new Set(['COMMENTED', 'PENDING'])

/**
 * Latest decision (`'APPROVED'`, `'CHANGES_REQUESTED'`, or `'DISMISSED'`) per
 * login, from every review strictly before `currentReviewId`. Excludes
 * `excludeLogin` (the pull request's own author) entirely: their review,
 * whatever it says, never counts. A comment-only or pending review never
 * overwrites an earlier decision, so a reviewer who approved and then only
 * commented is still counted as approved.
 *
 * `baseChangedAt`, when given, also drops any review submitted at or before
 * that timestamp: the pull request's base branch was retargeted at that
 * time, so an earlier review was given against a base the reviewer had no
 * reason to treat as this gate's release branch. This is what stops an
 * approval collected while the pull request targeted 'dev' from counting
 * once the base is switched to a release branch.
 */
export function latestDecisionsBefore(
  reviews: readonly Review[],
  currentReviewId: number,
  excludeLogin: string,
  baseChangedAt?: string
): Map<string, string> {
  const cutoff =
    baseChangedAt === undefined ? undefined : Date.parse(baseChangedAt)
  const latest = new Map<string, string>()
  const ordered = [...reviews].sort((a, b) => a.id - b.id)
  for (const review of ordered) {
    if (review.id >= currentReviewId) continue
    if (review.login === excludeLogin) continue
    if (NON_DECIDING_STATES.has(review.state)) continue
    if (cutoff !== undefined && Date.parse(review.submittedAt) <= cutoff) {
      continue
    }
    latest.set(review.login, review.state)
  }
  return latest
}

/** Logins whose latest decision is 'APPROVED'. */
export function approvedLogins(
  decisions: ReadonlyMap<string, string>
): string[] {
  return [...decisions]
    .filter(([, state]) => state === 'APPROVED')
    .map(([login]) => login)
}

export interface ApprovalGateInputs {
  reviews: readonly Review[]
  currentReviewId: number
  currentReviewerLogin: string
  prAuthorLogin: string
  requiredApprovals: number
  /** Logins already confirmed, via the API, to hold write or admin permission on this repository. */
  trustedLogins: ReadonlySet<string>
  /** Timestamp of the pull request's most recent base-branch retarget, if any. See latestDecisionsBefore(). */
  baseChangedAt?: string
}

export interface ApprovalGateResult {
  shouldRun: boolean
  /** Distinct trusted approvals counted before this one, against the current base branch. Always accurate, and always logged in the run summary. */
  trustedApprovalsBefore: number
  reason: string
}

/**
 * Decides whether the current review is the exact one that brings the
 * trusted approval count from `requiredApprovals - 1` to `requiredApprovals`.
 * Firing on that exact crossing, rather than on every approval once the
 * threshold is met, is what stops a third approval from launching a second
 * run.
 */
export function decideApprovalGate(
  inputs: ApprovalGateInputs
): ApprovalGateResult {
  // Computed up front, before any early return, so every reason below
  // reports the real count instead of a hardcoded zero.
  const decisions = latestDecisionsBefore(
    inputs.reviews,
    inputs.currentReviewId,
    inputs.prAuthorLogin,
    inputs.baseChangedAt
  )
  const trustedApprovalsBefore = approvedLogins(decisions).filter((login) =>
    inputs.trustedLogins.has(login)
  ).length

  if (inputs.currentReviewerLogin === inputs.prAuthorLogin) {
    return {
      shouldRun: false,
      trustedApprovalsBefore,
      reason:
        'The reviewer is the pull request author. A self-approval never counts.'
    }
  }

  if (!inputs.trustedLogins.has(inputs.currentReviewerLogin)) {
    return {
      shouldRun: false,
      trustedApprovalsBefore,
      reason: `${inputs.currentReviewerLogin} does not have write permission on this repository.`
    }
  }

  if (decisions.get(inputs.currentReviewerLogin) === 'APPROVED') {
    return {
      shouldRun: false,
      trustedApprovalsBefore,
      reason: `${inputs.currentReviewerLogin} already had a counted approval on this pull request. A repeat approval does not add to the count.`
    }
  }

  const shouldRun = trustedApprovalsBefore === inputs.requiredApprovals - 1
  return {
    shouldRun,
    trustedApprovalsBefore,
    reason: shouldRun
      ? `This approval brings the trusted count to ${String(inputs.requiredApprovals)}, the required threshold.`
      : `${String(trustedApprovalsBefore)} of ${String(inputs.requiredApprovals)} trusted approvals so far.`
  }
}

/**
 * Revision to launch. 'workflow_dispatch' and 'release' are always
 * maintainer-controlled (a manual dispatch, or a published tag), so they use
 * the commit the workflow actually runs on. An approved review instead
 * always launches the pipeline's own 'dev' branch, never the pull request's
 * own commits: see README.md's "Trusted revision" note for why.
 */
export function resolveRevision(eventName: string, sha: string): string {
  return eventName === 'workflow_dispatch' || eventName === 'release'
    ? sha
    : 'dev'
}
