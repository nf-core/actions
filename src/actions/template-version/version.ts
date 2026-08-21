// Pure comparison of the pipeline's configured nf-core/tools version against
// the latest release. Uses semver, a well-maintained dependency already
// trusted by npm itself, instead of a hand-rolled comparison: '2.10' must
// sort after '2.9', which a string or naive numeric split gets wrong, and a
// development suffix such as '3.27.0dev' is not valid strict semver on its
// own (no hyphen before the pre-release tag).

import { coerce, lt } from 'semver'

export type VersionStatus = 'up-to-date' | 'behind' | 'unknown'

export type Comparison =
  | { status: 'up-to-date' }
  | {
      status: 'behind'
      /**
       * The pipeline's version, coerced to bare 'major.minor.patch'. Never
       * `pipelineVersionRaw`: a pull request controls that string, and
       * anything beyond digits and dots in it must not reach a caller that
       * renders this value (see comment.ts).
       */
      pipelineVersion: string
    }
  | {
      status: 'unknown'
      /** Why the pipeline's version could not be compared. */
      reason: string
    }

/**
 * Compares `pipelineVersionRaw` (the pipeline's `nf_core_version`, from
 * .nf-core.yml on the pull request) against `latestVersionRaw` (a real
 * GitHub release tag, assumed already version-shaped).
 *
 * semver's coerce() extracts a leading major.minor.patch and drops anything
 * else, rather than treating a trailing suffix as a pre-release: '3.27.0dev'
 * coerces to the same version as '3.27.0', so it compares equal to it, not
 * less than it. Hyphenating the suffix into a real pre-release tag instead
 * would count every in-progress dev sync as behind its own eventual
 * release, which is noise for a check meant to flag a stale template, not
 * an unreleased one.
 *
 * 'unknown' means the pipeline's own version cannot be read as a version at
 * all (missing, or not version-shaped): there is nothing to compare, not a
 * pipeline that is behind.
 */
export function compareVersions(
  pipelineVersionRaw: string,
  latestVersionRaw: string
): Comparison {
  const pipelineVersion = pipelineVersionRaw.trim()
  if (pipelineVersion === '') {
    return { status: 'unknown', reason: "'nf-core-version' is not set." }
  }

  const pipeline = coerce(pipelineVersion)
  if (!pipeline) {
    return {
      status: 'unknown',
      reason: `'${pipelineVersion}' is not a recognisable version.`
    }
  }

  const latest = coerce(latestVersionRaw)
  if (!latest) {
    throw new Error(
      `The latest nf-core/tools release tag '${latestVersionRaw}' is not a recognisable version.`
    )
  }

  if (!lt(pipeline, latest)) {
    return { status: 'up-to-date' }
  }
  return { status: 'behind', pipelineVersion: pipeline.version }
}
