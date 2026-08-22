// GitHub API access for authorize-launch. Resolves permission through the
// API, not the review's 'author_association': that field describes a
// relationship (member, contributor, none), not a permission level, and a
// removed collaborator can keep an association that no longer reflects
// reality. See README.md.
//
// Each function takes the token and builds its own client, the same as
// template-version's fetchLatestToolsVersion(): getOctokit() only
// constructs a client, it makes no request itself, so building one per call
// costs nothing and keeps every function here independently testable
// without a hand-typed stand-in for the whole Octokit type.

import { getOctokit } from '@actions/github'
import type { Review } from './decide.js'

/**
 * True when `login` holds 'admin' or 'write' permission on `owner/repo'.
 * False for a 404 (not a collaborator at all): the same outcome as any
 * other non-collaborator, not an error. Any other failure propagates, so a
 * transient API error denies the launch instead of silently granting it.
 */
export async function hasWritePermission(
  token: string,
  owner: string,
  repo: string,
  login: string
): Promise<boolean> {
  const octokit = getOctokit(token)
  try {
    const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: login
    })
    // The legacy 'permission' field reports the 'maintain' role as 'write'.
    return data.permission === 'admin' || data.permission === 'write'
  } catch (error) {
    if ((error as { status?: number }).status === 404) return false
    throw error
  }
}

/**
 * Every review on the pull request, any state. Not necessarily oldest
 * first, so decide.ts sorts by id itself. Skips a review from a deleted
 * user (`user: null`): GitHub keeps the review but the login is gone, so it
 * can never be resolved to a permission and can never be the current,
 * trusted reviewer either.
 */
export async function listReviews(
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Review[]> {
  const octokit = getOctokit(token)
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100
  })
  return reviews
    .filter(
      (review): review is typeof review & { user: { login: string } } =>
        review.user?.login !== undefined
    )
    .map((review) => ({
      id: review.id,
      state: review.state,
      login: review.user.login,
      // Absent only for a 'PENDING' review (never submitted yet), which
      // decide.ts already excludes as a non-deciding state before it would
      // ever read this.
      submittedAt: review.submitted_at ?? ''
    }))
}

/**
 * Timestamp of the pull request's most recent base-branch retarget, or
 * `undefined` if it was never retargeted. GitHub's timeline records a
 * 'base_ref_changed' event for every retarget; the last one is the most
 * recent. decide.ts uses this to drop an approval given while the pull
 * request targeted a different base branch than the one being gated now.
 */
export async function latestBaseRefChangedAt(
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string | undefined> {
  const octokit = getOctokit(token)
  const events = await octokit.paginate(
    octokit.rest.issues.listEventsForTimeline,
    {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100
    }
  )
  // The timeline endpoint returns events in chronological order, so the
  // last 'base_ref_changed' event is the most recent retarget.
  const changes = events.filter(
    (event): event is typeof event & { created_at: string } =>
      event.event === 'base_ref_changed'
  )
  return changes.at(-1)?.created_at
}
