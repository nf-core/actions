// Reads nf-core/tools' latest release tag from the GitHub API.

import { getOctokit } from '@actions/github'

const OWNER = 'nf-core'
const REPO = 'tools'

/**
 * Fetches the tag of nf-core/tools' latest published release, for example
 * '4.1.0'. `token` only raises the request above the unauthenticated rate
 * limit: nf-core/tools is a public repository, so reading its release list
 * needs no scope at all, and this never writes anything with it.
 */
export async function fetchLatestToolsVersion(token: string): Promise<string> {
  const octokit = getOctokit(token)
  const { data } = await octokit.rest.repos.getLatestRelease({
    owner: OWNER,
    repo: REPO
  })
  return data.tag_name
}
