// Posts one status to a Mastodon-compatible instance's REST API. A single
// authenticated POST is well within what this repo's own reviewed code
// should do directly, with Node's built-in fetch, rather than through a
// third-party action (see CONTRIBUTING.md's "no third-party action in a
// privileged job" rule).

interface StatusResponse {
  url?: unknown
}

/**
 * Posts `text` as a new status on `host`, authenticated with `token`.
 * `idempotencyKey` is sent as Mastodon's own 'Idempotency-Key' header: a
 * retry (for example a workflow re-run after the first request's response
 * was lost) with the same key returns the original status instead of
 * creating a second one. Returns the status's own public URL. Throws on any
 * non-2xx response or a response missing the 'url' field; the response body
 * it throws with is the server's own JSON, which never contains `token`.
 */
export async function postToMastodon(
  host: string,
  token: string,
  text: string,
  idempotencyKey: string
): Promise<string> {
  const response = await fetch(`https://${host}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ status: text })
  })
  const bodyText = await response.text()

  if (!response.ok) {
    throw new Error(
      `Mastodon API returned ${String(response.status)}: ${bodyText}`
    )
  }

  let parsed: StatusResponse
  try {
    parsed = JSON.parse(bodyText) as StatusResponse
  } catch (error) {
    throw new Error(`Mastodon API returned a non-JSON response: ${bodyText}`, {
      cause: error
    })
  }

  if (typeof parsed.url !== 'string' || parsed.url === '') {
    throw new Error(`Mastodon API response had no 'url' field: ${bodyText}`)
  }
  return parsed.url
}
