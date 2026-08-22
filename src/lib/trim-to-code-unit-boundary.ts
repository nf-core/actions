// Shared by every action that truncates untrusted text to a fixed length
// (post-comment's comment body, announce-release's channel posts).

const HIGH_SURROGATE_MIN = 0xd800
const HIGH_SURROGATE_MAX = 0xdbff

/**
 * Trims `text` to at most `limit` UTF-16 code units, never splitting a
 * surrogate pair: a cut that lands between a high and low surrogate would
 * otherwise leave a lone, unpaired one at the end.
 */
export function trimToCodeUnitBoundary(text: string, limit: number): string {
  if (limit <= 0) return ''
  if (text.length <= limit) return text
  const lastCode = text.charCodeAt(limit - 1)
  const cutsASurrogatePair =
    lastCode >= HIGH_SURROGATE_MIN && lastCode <= HIGH_SURROGATE_MAX
  return text.slice(0, cutsASurrogatePair ? limit - 1 : limit)
}
