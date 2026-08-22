// Shared by every action that treats a pull request's base branch
// differently depending on whether it is this pipeline's release branch
// (branch's own source check, authorize-launch's full-test gate).

/** An nf-core pipeline's own release branches. Not a pipeline setting: every nf-core pipeline uses the same two names. */
const RELEASE_BRANCHES = ['main', 'master']

/** True when `baseRef` is one of this pipeline's release branches. */
export function isReleaseBranch(baseRef: string): boolean {
  return RELEASE_BRANCHES.includes(baseRef)
}
