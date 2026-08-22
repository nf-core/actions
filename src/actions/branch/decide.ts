// Pure decision: is a pull request's source branch one this pipeline's
// release branch accepts? No I/O here.
//
// isReleaseBranch() itself lives in src/lib/release-branch.ts, shared with
// authorize-launch's own full-test gate; import it from there directly.

export interface Source {
  /** Pull request head repository, full name (owner/repo). */
  headRepo: string
  /** Pull request head branch. */
  headRef: string
  /** This pipeline's own canonical repository, full name (owner/repo). */
  canonicalRepo: string
}

// nf-core convention, not a pipeline setting (see README.md): every
// nf-core pipeline's release branch (main/master) only ever accepts 'dev'
// (ongoing development) or a maintainer-pushed 'patch' branch (a hotfix
// based on the last release). Both live in the pipeline's own canonical
// repository, never a fork.
const ALLOWED_HEAD_REFS = ['dev', 'patch']

/**
 * True when `source.headRef` is 'dev' or 'patch' AND `source.headRepo` is
 * the pipeline's own canonical repository. Requiring the repository match
 * for 'patch' too, not only 'dev', closes a gap the vendored check this
 * replaces did not: that check allowed a branch literally named 'patch' in
 * ANY repository, including an unrelated fork, past its release-branch
 * guard.
 */
export function isAllowedSource(source: Source): boolean {
  return (
    source.headRepo === source.canonicalRepo &&
    ALLOWED_HEAD_REFS.includes(source.headRef)
  )
}
