import * as core from '@actions/core'
import { assertPositiveInteger } from '../../lib/positive-integer.js'
import { escapeHtml } from '../../lib/escape-html.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import { postToBluesky } from './bluesky.js'
import { composeAnnouncement, type ReleasePayload } from './compose.js'
import { postToMastodon } from './mastodon.js'

type Channel = 'mastodon' | 'bluesky'

interface Inputs {
  channel: Channel
  payload: ReleasePayload
  pipelineName: string
  repository: string
  maxLength: number
  mastodonHost: string
  mastodonToken: string
  blueskyIdentifier: string
  blueskyPassword: string
}

function parseChannel(raw: string): Channel {
  if (raw === 'mastodon' || raw === 'bluesky') return raw
  throw new Error(
    `Input 'channel' must be 'mastodon' or 'bluesky'. Got: ${raw}`
  )
}

function parsePrerelease(raw: string): boolean {
  if (raw === '' || raw.toLowerCase() === 'false') return false
  if (raw.toLowerCase() === 'true') return true
  throw new Error(`Input 'prerelease' must be 'true' or 'false'. Got: ${raw}`)
}

function parseMaxLength(raw: string): number {
  const value = Number(raw)
  assertPositiveInteger(value, "Input 'max-length'")
  return value
}

// A scheme ('https:', 'mailto:', ...) or any slash means the input is a URL
// or a path, not a bare host: the plausible mistake this catches is a host
// pasted straight from a browser's address bar ('https://mstdn.science'),
// which would otherwise build 'https://https://mstdn.science/...' and fail
// with an opaque parse error deep inside fetch().
const LOOKS_LIKE_URL = /^[a-z][a-z0-9+.-]*:|\//i

function parseMastodonHost(raw: string): string {
  const host = raw.trim()
  if (host === '') return 'mstdn.science'
  if (LOOKS_LIKE_URL.test(host)) {
    throw new Error(
      `Input 'mastodon-host' must be a bare host name, like 'mstdn.science', not a URL. Got: '${host}'`
    )
  }
  return host
}

function readInputs(): Inputs {
  return {
    channel: parseChannel(core.getInput('channel', { required: true })),
    payload: {
      tagName: core.getInput('tag-name', { required: true }),
      releaseName: core.getInput('release-name'),
      body: core.getInput('body'),
      htmlUrl: core.getInput('html-url', { required: true }),
      prerelease: parsePrerelease(core.getInput('prerelease'))
    },
    pipelineName: core.getInput('pipeline-name'),
    repository: core.getInput('repository', { required: true }),
    maxLength: parseMaxLength(core.getInput('max-length', { required: true })),
    mastodonHost: parseMastodonHost(core.getInput('mastodon-host')),
    mastodonToken: core.getInput('mastodon-token'),
    blueskyIdentifier: core.getInput('bluesky-identifier'),
    blueskyPassword: core.getInput('bluesky-password')
  }
}

function writeSummary(channel: Channel, postUrl: string): Promise<void> {
  core.summary
    .addHeading(`announce-release: ${channel}`, 3)
    .addRaw(`Posted: ${escapeHtml(postUrl)}`, true)
  return writeSummaryBestEffort()
}

/**
 * Composes a release announcement and posts it to one channel. The caller
 * (release-announcements.yml) decides whether to invoke this at all: it
 * skips the whole step, with its own log line, when the channel's secret is
 * not configured. Reaching this action always means "post now".
 */
export async function run(): Promise<void> {
  const inputs = readInputs()

  const text = composeAnnouncement(inputs.payload, {
    pipelineName: inputs.pipelineName,
    repository: inputs.repository,
    maxLength: inputs.maxLength
  })

  // JSON-encoded: the composed text carries the release's own name and
  // body, author-controlled text, so a value containing a newline can't
  // inject a workflow command into the log (same reasoning as
  // read-config's own resolved-value log line).
  core.info(`Composed ${inputs.channel} text: ${JSON.stringify(text)}`)

  let postUrl: string
  if (inputs.channel === 'mastodon') {
    if (!inputs.mastodonToken) {
      throw new Error("channel is 'mastodon' but 'mastodon-token' is empty.")
    }
    postUrl = await postToMastodon(
      inputs.mastodonHost,
      inputs.mastodonToken,
      text,
      // Stable per repository + tag: a re-run of the same release event
      // sends the same key, so Mastodon returns the original status
      // instead of creating a duplicate. See mastodon.ts's own comment.
      `${inputs.repository}@${inputs.payload.tagName}`
    )
  } else {
    if (!inputs.blueskyIdentifier || !inputs.blueskyPassword) {
      throw new Error(
        "channel is 'bluesky' but 'bluesky-identifier' and/or 'bluesky-password' is empty."
      )
    }
    postUrl = await postToBluesky(
      inputs.blueskyIdentifier,
      inputs.blueskyPassword,
      text
    )
  }

  core.setOutput('post-url', postUrl)
  await writeSummary(inputs.channel, postUrl)
}
