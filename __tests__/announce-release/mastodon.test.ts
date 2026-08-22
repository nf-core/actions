import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { postToMastodon } from '../../src/actions/announce-release/mastodon.js'

function fakeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text)
  } as Response
}

describe('postToMastodon', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('posts the status and returns its URL', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        fakeResponse(200, { url: 'https://mstdn.science/@nf_core/123' })
      )

    const url = await postToMastodon(
      'mstdn.science',
      'a-token',
      'hello world',
      'nf-core/rnaseq@3.14.0'
    )

    expect(url).toBe('https://mstdn.science/@nf_core/123')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mstdn.science/api/v1/statuses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer a-token',
          'Idempotency-Key': 'nf-core/rnaseq@3.14.0'
        })
      })
    )
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toEqual({
      status: 'hello world'
    })
  })

  it('throws with the response body on a non-2xx response, without the token', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse(401, { error: 'invalid token' }))

    await expect(
      postToMastodon('mstdn.science', 'secret-token', 'hello', 'key')
    ).rejects.toThrow(/401.*invalid token/s)

    const error: unknown = await postToMastodon(
      'mstdn.science',
      'secret-token',
      'hello',
      'key'
    ).catch((caught: unknown) => caught)
    expect(String(error)).not.toContain('secret-token')
  })

  it('throws when the response has no url field', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse(200, {}))

    await expect(
      postToMastodon('mstdn.science', 'a-token', 'hello', 'key')
    ).rejects.toThrow(/no 'url' field/)
  })

  it('throws on a non-JSON response', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse(200, 'not json'))

    await expect(
      postToMastodon('mstdn.science', 'a-token', 'hello', 'key')
    ).rejects.toThrow(/non-JSON response/)
  })
})
