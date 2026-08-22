import { describe, expect, it } from '@jest/globals'
import {
  approvedLogins,
  decideApprovalGate,
  latestDecisionsBefore,
  resolveRevision,
  type Review
} from '../../src/actions/authorize-launch/decide.js'

const AUTHOR = 'pr-author'

function review(
  id: number,
  login: string,
  state: string,
  submittedAt = '2024-01-01T00:00:00Z'
): Review {
  return { id, login, state, submittedAt }
}

describe('latestDecisionsBefore', () => {
  it('keeps only the latest decision per login, ordered by id, not array order', () => {
    const decisions = latestDecisionsBefore(
      [review(3, 'alice', 'CHANGES_REQUESTED'), review(1, 'alice', 'APPROVED')],
      10,
      AUTHOR
    )
    expect(decisions.get('alice')).toBe('CHANGES_REQUESTED')
  })

  it('excludes any review at or after currentReviewId', () => {
    const decisions = latestDecisionsBefore(
      [review(5, 'alice', 'APPROVED')],
      5,
      AUTHOR
    )
    expect(decisions.has('alice')).toBe(false)
  })

  it('excludes the pull request author entirely', () => {
    const decisions = latestDecisionsBefore(
      [review(1, AUTHOR, 'APPROVED')],
      10,
      AUTHOR
    )
    expect(decisions.has(AUTHOR)).toBe(false)
  })

  it('does not let a later comment or pending review overwrite an earlier approval', () => {
    const decisions = latestDecisionsBefore(
      [review(1, 'alice', 'APPROVED'), review(2, 'alice', 'COMMENTED')],
      10,
      AUTHOR
    )
    expect(decisions.get('alice')).toBe('APPROVED')
  })

  it('lets a later dismissal overwrite an earlier approval', () => {
    const decisions = latestDecisionsBefore(
      [review(1, 'alice', 'APPROVED'), review(2, 'alice', 'DISMISSED')],
      10,
      AUTHOR
    )
    expect(decisions.get('alice')).toBe('DISMISSED')
  })

  it('lets a later request-changes overwrite an earlier approval', () => {
    const decisions = latestDecisionsBefore(
      [review(1, 'alice', 'APPROVED'), review(2, 'alice', 'CHANGES_REQUESTED')],
      10,
      AUTHOR
    )
    expect(decisions.get('alice')).toBe('CHANGES_REQUESTED')
  })

  it('drops a review submitted at or before baseChangedAt', () => {
    const decisions = latestDecisionsBefore(
      [review(1, 'alice', 'APPROVED', '2024-01-01T00:00:00Z')],
      10,
      AUTHOR,
      '2024-01-01T00:00:00Z'
    )
    expect(decisions.has('alice')).toBe(false)
  })

  it('keeps a review submitted after baseChangedAt', () => {
    const decisions = latestDecisionsBefore(
      [review(1, 'alice', 'APPROVED', '2024-01-02T00:00:00Z')],
      10,
      AUTHOR,
      '2024-01-01T00:00:00Z'
    )
    expect(decisions.get('alice')).toBe('APPROVED')
  })

  it('keeps every review when baseChangedAt is not given', () => {
    const decisions = latestDecisionsBefore(
      [review(1, 'alice', 'APPROVED', '2020-01-01T00:00:00Z')],
      10,
      AUTHOR
    )
    expect(decisions.get('alice')).toBe('APPROVED')
  })
})

describe('approvedLogins', () => {
  it('returns only logins whose latest decision is APPROVED', () => {
    const decisions = new Map([
      ['alice', 'APPROVED'],
      ['bob', 'CHANGES_REQUESTED']
    ])
    expect(approvedLogins(decisions)).toEqual(['alice'])
  })
})

describe('decideApprovalGate', () => {
  const base = {
    reviews: [] as Review[],
    currentReviewId: 100,
    currentReviewerLogin: 'bob',
    prAuthorLogin: AUTHOR,
    requiredApprovals: 2,
    trustedLogins: new Set(['bob'])
  }

  it('does not run with fewer trusted approvals than required', () => {
    // No prior approval at all: this is the first, and two are required.
    const result = decideApprovalGate(base)
    expect(result.shouldRun).toBe(false)
    expect(result.trustedApprovalsBefore).toBe(0)
  })

  it('runs exactly when this approval reaches the required threshold', () => {
    const result = decideApprovalGate({
      ...base,
      reviews: [review(1, 'alice', 'APPROVED')],
      trustedLogins: new Set(['bob', 'alice'])
    })
    expect(result.shouldRun).toBe(true)
    expect(result.trustedApprovalsBefore).toBe(1)
  })

  it('does not run again for a further approval beyond the threshold', () => {
    // alice and carol already approved and are trusted: the threshold (2)
    // was already crossed before bob's approval arrives.
    const result = decideApprovalGate({
      ...base,
      reviews: [review(1, 'alice', 'APPROVED'), review(2, 'carol', 'APPROVED')],
      trustedLogins: new Set(['bob', 'alice', 'carol'])
    })
    expect(result.shouldRun).toBe(false)
    expect(result.trustedApprovalsBefore).toBe(2)
  })

  it('does not run when the current reviewer is not in trustedLogins', () => {
    // run.ts always adds the current reviewer to trustedLogins once their
    // own permission is confirmed, so this only exercises decideApprovalGate
    // defensively, for a caller that has not done that check.
    const result = decideApprovalGate({ ...base, trustedLogins: new Set() })
    expect(result.shouldRun).toBe(false)
    expect(result.reason).toContain('does not have write permission')
  })

  it('does not count an approval from someone without write permission', () => {
    const result = decideApprovalGate({
      ...base,
      reviews: [review(1, 'alice', 'APPROVED')],
      // alice approved, but is not in trustedLogins.
      trustedLogins: new Set(['bob'])
    })
    expect(result.shouldRun).toBe(false)
    expect(result.trustedApprovalsBefore).toBe(0)
  })

  it('counts two approvals from the same person once, not twice', () => {
    // bob (the current reviewer) approved once already, at id 1; id 2 is a
    // second, later APPROVED review by the same login, still before the
    // current review at id 100. Only one distinct approver, alice, plus
    // bob's own repeat: still one trusted approval before this one.
    const result = decideApprovalGate({
      ...base,
      reviews: [review(1, 'alice', 'APPROVED'), review(2, 'alice', 'APPROVED')],
      trustedLogins: new Set(['bob', 'alice'])
    })
    expect(result.trustedApprovalsBefore).toBe(1)
  })

  it('does not run for a repeat approval by the current reviewer, and still reports the real count', () => {
    const result = decideApprovalGate({
      ...base,
      reviews: [review(1, 'bob', 'APPROVED')],
      trustedLogins: new Set(['bob'])
    })
    expect(result.shouldRun).toBe(false)
    expect(result.reason).toContain('already had a counted approval')
    // bob's own earlier approval is a real, distinct trusted approval: the
    // early return above must not hide it behind a hardcoded zero.
    expect(result.trustedApprovalsBefore).toBe(1)
  })

  it('does not run when an earlier approval was later dismissed', () => {
    const result = decideApprovalGate({
      ...base,
      reviews: [
        review(1, 'alice', 'APPROVED'),
        review(2, 'alice', 'DISMISSED')
      ],
      trustedLogins: new Set(['bob', 'alice'])
    })
    expect(result.shouldRun).toBe(false)
    expect(result.trustedApprovalsBefore).toBe(0)
  })

  it('does not run when an earlier approval was later changed to request-changes', () => {
    const result = decideApprovalGate({
      ...base,
      reviews: [
        review(1, 'alice', 'APPROVED'),
        review(2, 'alice', 'CHANGES_REQUESTED')
      ],
      trustedLogins: new Set(['bob', 'alice'])
    })
    expect(result.shouldRun).toBe(false)
    expect(result.trustedApprovalsBefore).toBe(0)
  })

  it('never runs for a self-approval by the pull request author', () => {
    const result = decideApprovalGate({
      ...base,
      currentReviewerLogin: AUTHOR,
      trustedLogins: new Set([AUTHOR])
    })
    expect(result.shouldRun).toBe(false)
    expect(result.reason).toContain('pull request author')
  })

  it('excludes the pull request author from every other approval count too', () => {
    const result = decideApprovalGate({
      ...base,
      reviews: [review(1, AUTHOR, 'APPROVED')],
      trustedLogins: new Set(['bob', AUTHOR])
    })
    expect(result.trustedApprovalsBefore).toBe(0)
    expect(result.shouldRun).toBe(false)
  })

  it('runs on the first approval when only one is required', () => {
    const result = decideApprovalGate({ ...base, requiredApprovals: 1 })
    expect(result.shouldRun).toBe(true)
    expect(result.trustedApprovalsBefore).toBe(0)
  })

  it('does not count an approval given before the base branch was last retargeted', () => {
    // alice approved while the pull request targeted a different base
    // branch; it was retargeted after her review but before bob's.
    const result = decideApprovalGate({
      ...base,
      reviews: [review(1, 'alice', 'APPROVED', '2024-01-01T00:00:00Z')],
      trustedLogins: new Set(['bob', 'alice']),
      baseChangedAt: '2024-01-02T00:00:00Z'
    })
    expect(result.shouldRun).toBe(false)
    expect(result.trustedApprovalsBefore).toBe(0)
  })

  it('counts an approval given after the base branch was last retargeted', () => {
    const result = decideApprovalGate({
      ...base,
      reviews: [review(1, 'alice', 'APPROVED', '2024-01-03T00:00:00Z')],
      trustedLogins: new Set(['bob', 'alice']),
      baseChangedAt: '2024-01-02T00:00:00Z'
    })
    expect(result.shouldRun).toBe(true)
    expect(result.trustedApprovalsBefore).toBe(1)
  })
})

describe('resolveRevision', () => {
  it('uses the sha for workflow_dispatch', () => {
    expect(resolveRevision('workflow_dispatch', 'abc123')).toBe('abc123')
  })

  it('uses the sha for release', () => {
    expect(resolveRevision('release', 'abc123')).toBe('abc123')
  })

  it('always uses dev for an approved pull request review, never the sha', () => {
    expect(resolveRevision('pull_request_review', 'abc123')).toBe('dev')
  })
})
