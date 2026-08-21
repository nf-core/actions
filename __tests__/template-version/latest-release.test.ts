import { describe, expect, it, jest } from '@jest/globals'

const getLatestRelease =
  jest.fn<(params: unknown) => Promise<{ data: { tag_name: string } }>>()

const fakeOctokit = { rest: { repos: { getLatestRelease } } }
const getOctokit = jest.fn<(token: string) => typeof fakeOctokit>(
  () => fakeOctokit
)

jest.unstable_mockModule('@actions/github', () => ({ getOctokit }))

const { fetchLatestToolsVersion } =
  await import('../../src/actions/template-version/latest-release.js')

describe('fetchLatestToolsVersion', () => {
  it('returns the tag_name of the latest release', async () => {
    getLatestRelease.mockResolvedValue({ data: { tag_name: '4.1.0' } })

    await expect(fetchLatestToolsVersion('a-token')).resolves.toBe('4.1.0')
    expect(getOctokit).toHaveBeenCalledWith('a-token')
    expect(getLatestRelease).toHaveBeenCalledWith({
      owner: 'nf-core',
      repo: 'tools'
    })
  })

  it('propagates a rejected request unchanged', async () => {
    getLatestRelease.mockRejectedValue(
      Object.assign(new Error('rate limited'), { status: 403 })
    )

    await expect(fetchLatestToolsVersion('a-token')).rejects.toThrow(
      'rate limited'
    )
  })
})
