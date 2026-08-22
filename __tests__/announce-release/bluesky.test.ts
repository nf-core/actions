import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { postToBluesky } from '../../src/actions/announce-release/bluesky.js'

function fakeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text)
  } as Response
}

describe('postToBluesky', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('logs in, creates the record, and derives the post URL from the record URI', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        fakeResponse(200, { accessJwt: 'a-jwt', did: 'did:plc:abc123' })
      )
      .mockResolvedValueOnce(
        fakeResponse(200, {
          uri: 'at://did:plc:abc123/app.bsky.feed.post/xyz789',
          cid: 'bafyabc'
        })
      )

    const url = await postToBluesky(
      'nf-core.bsky.social',
      'app-password',
      'hello world'
    )

    expect(url).toBe('https://bsky.app/profile/did:plc:abc123/post/xyz789')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [loginUrl, loginOptions] = fetchMock.mock.calls[0] as [
      string,
      RequestInit
    ]
    expect(loginUrl).toBe(
      'https://bsky.social/xrpc/com.atproto.server.createSession'
    )
    expect(JSON.parse(loginOptions.body as string)).toEqual({
      identifier: 'nf-core.bsky.social',
      password: 'app-password'
    })

    const [postUrl, postOptions] = fetchMock.mock.calls[1] as [
      string,
      RequestInit
    ]
    expect(postUrl).toBe(
      'https://bsky.social/xrpc/com.atproto.repo.createRecord'
    )
    expect((postOptions.headers as Record<string, string>).Authorization).toBe(
      'Bearer a-jwt'
    )
    const record = JSON.parse(postOptions.body as string) as {
      repo: string
      collection: string
      record: { text: string }
    }
    expect(record.repo).toBe('did:plc:abc123')
    expect(record.collection).toBe('app.bsky.feed.post')
    expect(record.record.text).toBe('hello world')
  })

  it('throws on a failed login, without the password, and never calls createRecord', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse(401, { error: 'invalid credentials' }))

    await expect(
      postToBluesky('nf-core.bsky.social', 'wrong-password', 'hello')
    ).rejects.toThrow(/401.*invalid credentials/s)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const error: unknown = await postToBluesky(
      'nf-core.bsky.social',
      'wrong-password',
      'hello'
    ).catch((caught: unknown) => caught)
    expect(String(error)).not.toContain('wrong-password')
  })

  it('throws on a non-JSON login response', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse(200, 'not json'))

    await expect(
      postToBluesky('nf-core.bsky.social', 'app-password', 'hello')
    ).rejects.toThrow(/Bluesky login.*non-JSON response/s)
  })

  it('throws when the login response has no accessJwt/did field', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse(200, {}))

    await expect(
      postToBluesky('nf-core.bsky.social', 'app-password', 'hello')
    ).rejects.toThrow(/no 'accessJwt'\/'did' field/)
  })

  it('throws when the createRecord response has no uri field', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        fakeResponse(200, { accessJwt: 'a-jwt', did: 'did:plc:abc123' })
      )
      .mockResolvedValueOnce(fakeResponse(200, {}))

    await expect(
      postToBluesky('nf-core.bsky.social', 'app-password', 'hello')
    ).rejects.toThrow(/no 'uri' field/)
  })
})
