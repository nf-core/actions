// Pure composition of the PR comment body. No I/O here.

/**
 * Builds the comment body for a pull request whose source branch is not
 * allowed. Only called when isAllowedSource() reports false.
 *
 * Deliberately does not state the actual head branch: post-comment's own
 * sanitisation turns any '@mention' in a producer's comment.md into inline
 * code (see README.md), so `prUser` below renders as text, not a
 * notification; naming the disallowed branch itself would add nothing a
 * contributor cannot already see on their own pull request page.
 */
export function buildComment(
  baseRef: string,
  canonicalRepo: string,
  prUser: string
): string {
  return `## This PR is against the \`${baseRef}\` branch :x:

* Do not close this PR
* Click **Edit** and change the base branch to \`dev\`
* This check keeps failing until the target branch changes

---

Hi @${prUser},

This pull request targets [\`${canonicalRepo}\`](https://github.com/${canonicalRepo})'s \`${baseRef}\` branch. On nf-core pipelines, \`${baseRef}\` always tracks the latest release, so it only accepts pull requests from \`${canonicalRepo}\`'s own \`dev\` branch, or its \`patch\` branch for a hotfix.

You do not need to close this pull request. Click **Edit** at the top of this page and change the base branch to \`dev\`.

Thanks for contributing to nf-core!
`
}
