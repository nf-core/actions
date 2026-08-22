// Posts one record to Bluesky's AT Protocol PDS: log in for a session
// token, then create the post record. Same reasoning as mastodon.ts for why
// this is a direct fetch() call, not a third-party action.
//
// ponytail: does not compute rich-text facets (clickable links or
// hashtags). A facet needs a UTF-8 byte-offset span per the AT Protocol
// lexicon, which the third-party action this replaces builds with
// '@atproto/api'. The post still carries the full text, including the URL,
// as plain text — a reader can see and copy it, just not tap it. Add facet
// computation if clickable links become worth the extra dependency.

const SERVICE = 'https://bsky.social'

interface Session {
  accessJwt: string
  did: string
}

interface SessionResponse {
  accessJwt?: unknown
  did?: unknown
}

interface CreateRecordResponse {
  uri?: unknown
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  const bodyText = await response.text()
  if (!response.ok) {
    throw new Error(`${what} returned ${String(response.status)}: ${bodyText}`)
  }
  try {
    return JSON.parse(bodyText) as T
  } catch (error) {
    throw new Error(`${what} returned a non-JSON response: ${bodyText}`, {
      cause: error
    })
  }
}

async function createSession(
  identifier: string,
  password: string
): Promise<Session> {
  const response = await fetch(
    `${SERVICE}/xrpc/com.atproto.server.createSession`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    }
  )
  const session = await readJson<SessionResponse>(response, 'Bluesky login')
  if (
    typeof session.accessJwt !== 'string' ||
    typeof session.did !== 'string'
  ) {
    throw new Error(
      `Bluesky login response had no 'accessJwt'/'did' field: ${JSON.stringify(session)}`
    )
  }
  return { accessJwt: session.accessJwt, did: session.did }
}

/** Converts an 'at://<did>/app.bsky.feed.post/<rkey>' record URI into its web URL. */
function derivePostUrl(uri: string, did: string): string {
  const rkey = uri.split('/').pop()
  return `https://bsky.app/profile/${did}/post/${rkey ?? ''}`
}

/**
 * Logs in as `identifier`/`password`, then posts `text` as a new
 * 'app.bsky.feed.post' record. Returns the post's own web URL. Throws on
 * any non-2xx response from either call; neither response body can contain
 * `password`, only the server's own JSON.
 */
export async function postToBluesky(
  identifier: string,
  password: string,
  text: string
): Promise<string> {
  const session = await createSession(identifier, password)

  const response = await fetch(
    `${SERVICE}/xrpc/com.atproto.repo.createRecord`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text,
          createdAt: new Date().toISOString()
        }
      })
    }
  )
  const created = await readJson<CreateRecordResponse>(response, 'Bluesky post')
  if (typeof created.uri !== 'string') {
    throw new Error(
      `Bluesky post response had no 'uri' field: ${JSON.stringify(created)}`
    )
  }
  return derivePostUrl(created.uri, session.did)
}
