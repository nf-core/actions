// Pure composition of the nf-test PR comment body from fragment lines. No
// I/O here; run.ts reads the fragment files and hands this the result.

// Defensive cap on how many failed-leg lines the comment lists. A pipeline
// can configure enough shards and profiles to fail far more legs than any
// comment needs to list one by one; capping here keeps comment.md well
// under post-comment's own read cap (artifact.ts) regardless of how many
// legs fail.
const MAX_FRAGMENTS_LISTED = 200

/**
 * Builds the comment body reporting one or more legs that failed against
 * Nextflow's floating 'latest' version. `fragments` are the trimmed lines
 * each failed leg wrote; `runUrl` links to the full run for detail.
 */
export function buildComment(fragments: string[], runUrl: string): string {
  const shown = fragments.slice(0, MAX_FRAGMENTS_LISTED)
  const omitted = fragments.length - shown.length
  const lines =
    omitted > 0 ? [...shown, `* … and ${String(omitted)} more.`] : shown

  return `## nf-test failed with Nextflow's latest version

> [!NOTE]
> These legs run Nextflow's floating \`latest\` version. This does not fail CI. It may be an upstream Nextflow regression, or a real problem in this pipeline.

${lines.join('\n')}

See the [full run](${runUrl}) for details.
`
}

/**
 * Builds the resolved.md body that replaces an earlier failure comment once
 * every leg against Nextflow's latest version passes again. A later push
 * that fixes the pipeline, or an upstream Nextflow fix, both make this the
 * right decision on the next run: unlike branch.yml's decision, this one
 * can flip back.
 */
export function buildResolvedComment(runUrl: string): string {
  return `nf-test now passes against Nextflow's latest version. See the [full run](${runUrl}).\n`
}
