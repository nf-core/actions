// Pure composition of the PR comment body. No I/O here.

const DOCS_URL = 'https://nf-co.re/docs/developing/template-syncs/overview'

/**
 * Builds the comment body for a pipeline behind the latest nf-core/tools
 * release. Only called when compareVersions() reports 'behind'.
 *
 * Kept factual: stage 7's post-comment posts this verbatim (past its own
 * mention/image/marker neutralisation), so it states the two versions and
 * links to the one thing a maintainer needs, nothing more.
 */
export function buildComment(
  pipelineVersion: string,
  latestVersion: string
): string {
  return `> [!WARNING]
> A newer version of the nf-core template is available.
>
> This pipeline uses nf-core/tools version ${pipelineVersion}. The latest release is ${latestVersion}.
>
> See the [synchronisation documentation](${DOCS_URL}) for how to update.
`
}

/**
 * Builds the resolved.md body that replaces an earlier 'behind' comment
 * once the pipeline has caught up. Only called when compareVersions()
 * reports 'up-to-date'.
 *
 * States only `latestVersion`, a trusted GitHub release tag, never the
 * pipeline's own configured version: unlike buildComment(), there is
 * nothing pull-request-controlled to keep out this way (see run.ts).
 */
export function buildResolvedComment(latestVersion: string): string {
  return `This pipeline's nf-core/tools template is up to date with the latest release, ${latestVersion}.\n`
}
