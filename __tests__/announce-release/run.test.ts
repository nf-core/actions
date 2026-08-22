// Only the network layer is mocked ('mastodon.js' and 'bluesky.js'):
// compose.ts already has its own direct, unmocked tests. This exercises
// run.ts's own wiring: input reading, the missing-credential guard, and
// the output/summary calls.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const getInput =
  jest.fn<(name: string, options?: { required?: boolean }) => string>()
const setOutput = jest.fn<(name: string, value: string) => void>()
const info = jest.fn()
const write = jest.fn(() => Promise.resolve())
const summary: Record<string, jest.Mock> = {}
summary.addHeading = jest.fn(() => summary)
summary.addRaw = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({
  getInput,
  setOutput,
  info,
  summary
}))

const postToMastodon =
  jest.fn<
    (
      host: string,
      token: string,
      text: string,
      idempotencyKey: string
    ) => Promise<string>
  >()
const postToBluesky =
  jest.fn<
    (identifier: string, password: string, text: string) => Promise<string>
  >()

jest.unstable_mockModule(
  '../../src/actions/announce-release/mastodon.js',
  () => ({
    postToMastodon
  })
)
jest.unstable_mockModule(
  '../../src/actions/announce-release/bluesky.js',
  () => ({
    postToBluesky
  })
)

const { run } = await import('../../src/actions/announce-release/run.js')

const DEFAULT_INPUTS: Record<string, string> = {
  channel: 'mastodon',
  'tag-name': '3.14.0',
  'release-name': '',
  body: '',
  'html-url': 'https://github.com/nf-core/rnaseq/releases/tag/3.14.0',
  prerelease: 'false',
  'pipeline-name': 'rnaseq',
  repository: 'nf-core/rnaseq',
  'max-length': '500',
  'mastodon-host': 'mstdn.science',
  'mastodon-token': 'a-token',
  'bluesky-identifier': '',
  'bluesky-password': ''
}

function setInputs(overrides: Record<string, string> = {}): void {
  const values = { ...DEFAULT_INPUTS, ...overrides }
  getInput.mockImplementation((name, options) => {
    const raw = values[name] ?? ''
    if (options?.required && !raw) {
      throw new Error(`Input required and not supplied: ${name}`)
    }
    return raw
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  postToMastodon.mockResolvedValue('https://mstdn.science/@nf_core/123')
  postToBluesky.mockResolvedValue('https://bsky.app/profile/did:plc:x/post/y')
})

describe('run (mastodon)', () => {
  it('composes the text, posts to mastodon, and sets the post-url output', async () => {
    setInputs()
    await run()

    expect(postToMastodon).toHaveBeenCalledWith(
      'mstdn.science',
      'a-token',
      expect.stringContaining('rnaseq'),
      'nf-core/rnaseq@3.14.0'
    )
    expect(postToBluesky).not.toHaveBeenCalled()
    expect(setOutput).toHaveBeenCalledWith(
      'post-url',
      'https://mstdn.science/@nf_core/123'
    )
  })

  it('marks the composed text as a pre-release when prerelease is true', async () => {
    setInputs({ prerelease: 'true' })
    await run()

    expect(postToMastodon).toHaveBeenCalledWith(
      'mstdn.science',
      'a-token',
      expect.stringContaining('pre-release'),
      expect.anything()
    )
  })

  it('falls back to mstdn.science when mastodon-host is empty', async () => {
    setInputs({ 'mastodon-host': '' })
    await run()

    expect(postToMastodon).toHaveBeenCalledWith(
      'mstdn.science',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('sends an idempotency key derived from the repository and the tag', async () => {
    setInputs({ repository: 'nf-core/sarek', 'tag-name': '1.2.3' })
    await run()

    expect(postToMastodon).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'nf-core/sarek@1.2.3'
    )
  })

  it('throws, and never posts, when mastodon-token is empty', async () => {
    setInputs({ 'mastodon-token': '' })
    await expect(run()).rejects.toThrow(/mastodon-token/)
    expect(postToMastodon).not.toHaveBeenCalled()
  })

  it('rejects a mastodon-host that looks like a URL', async () => {
    setInputs({ 'mastodon-host': 'https://mstdn.science' })
    await expect(run()).rejects.toThrow(/mastodon-host/)
    expect(postToMastodon).not.toHaveBeenCalled()
  })

  it('rejects a mastodon-host containing a path', async () => {
    setInputs({ 'mastodon-host': 'mstdn.science/mastodon' })
    await expect(run()).rejects.toThrow(/mastodon-host/)
    expect(postToMastodon).not.toHaveBeenCalled()
  })
})

describe('run (bluesky)', () => {
  it('composes the text, posts to bluesky, and sets the post-url output', async () => {
    setInputs({
      channel: 'bluesky',
      'mastodon-token': '',
      'bluesky-identifier': 'nf-core.bsky.social',
      'bluesky-password': 'an-app-password'
    })
    await run()

    expect(postToBluesky).toHaveBeenCalledWith(
      'nf-core.bsky.social',
      'an-app-password',
      expect.stringContaining('rnaseq')
    )
    expect(postToMastodon).not.toHaveBeenCalled()
    expect(setOutput).toHaveBeenCalledWith(
      'post-url',
      'https://bsky.app/profile/did:plc:x/post/y'
    )
  })

  it('throws, and never posts, when bluesky-identifier or bluesky-password is empty', async () => {
    setInputs({
      channel: 'bluesky',
      'mastodon-token': '',
      'bluesky-identifier': 'nf-core.bsky.social',
      'bluesky-password': ''
    })
    await expect(run()).rejects.toThrow(/bluesky-identifier.*bluesky-password/)
    expect(postToBluesky).not.toHaveBeenCalled()
  })
})

describe('run (input validation)', () => {
  it('rejects a channel that is neither mastodon nor bluesky', async () => {
    setInputs({ channel: 'twitter' })
    await expect(run()).rejects.toThrow(/channel/)
  })

  it('rejects a prerelease value that is not true or false', async () => {
    setInputs({ prerelease: 'yes' })
    await expect(run()).rejects.toThrow(/prerelease/)
  })

  it('rejects a max-length that is not a positive integer', async () => {
    setInputs({ 'max-length': '0' })
    await expect(run()).rejects.toThrow(/max-length/)
  })
})
