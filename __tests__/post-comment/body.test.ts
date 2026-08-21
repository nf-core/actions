import { describe, expect, it } from '@jest/globals'
import {
  buildCommentBody,
  MAX_COMMENT_BODY_LENGTH
} from '../../src/actions/post-comment/body.js'

const MARKER = '<!-- nf-core-actions:pr-comment:lint -->'

describe('buildCommentBody', () => {
  it('prefixes the body with the marker, on its own line', () => {
    expect(buildCommentBody(MARKER, 'All good.')).toBe(`${MARKER}\nAll good.`)
  })

  it('passes an ordinary-sized body through unchanged, besides the marker', () => {
    const body = 'x'.repeat(1000)
    const result = buildCommentBody(MARKER, body)
    expect(result).toBe(`${MARKER}\n${body}`)
    expect(result.length).toBeLessThan(MAX_COMMENT_BODY_LENGTH)
  })

  it('caps the result at MAX_COMMENT_BODY_LENGTH for an oversized body', () => {
    const body = 'x'.repeat(MAX_COMMENT_BODY_LENGTH * 2)
    const result = buildCommentBody(MARKER, body)
    expect(result.length).toBe(MAX_COMMENT_BODY_LENGTH)
  })

  it('keeps the marker intact even when the body is truncated', () => {
    const body = 'x'.repeat(MAX_COMMENT_BODY_LENGTH * 2)
    const result = buildCommentBody(MARKER, body)
    expect(result.startsWith(`${MARKER}\n`)).toBe(true)
  })

  it('appends a truncation notice when the body is cut', () => {
    const body = 'x'.repeat(MAX_COMMENT_BODY_LENGTH * 2)
    const result = buildCommentBody(MARKER, body)
    expect(result).toContain('truncated')
  })

  it('closes an unterminated code fence before the truncation notice', () => {
    // One opening fence, no closing one anywhere in this much text: the
    // truncation point always lands inside it.
    const body = '```\n' + 'a line of output\n'.repeat(MAX_COMMENT_BODY_LENGTH)
    const result = buildCommentBody(MARKER, body)

    const fenceLines = result.match(/^```.*$/gm) ?? []
    // An even count means every fence this comment opens is also closed,
    // so the notice below renders as text, not as part of the code block.
    expect(fenceLines.length % 2).toBe(0)
    const closeIndex = result.lastIndexOf('```')
    const noticeIndex = result.indexOf('truncated')
    expect(closeIndex).toBeGreaterThan(-1)
    expect(closeIndex).toBeLessThan(noticeIndex)
    expect(result.length).toBeLessThanOrEqual(MAX_COMMENT_BODY_LENGTH)
  })

  it('does not touch a fence that is already closed well within the budget', () => {
    const body = '```\ncode\n```\n' + 'plain text after the fence'
    const result = buildCommentBody(MARKER, body)
    expect(result).toBe(`${MARKER}\n${body}`)
  })

  it('never reads a negative code-unit budget as room for content', () => {
    // A marker this large never happens in practice (buildMarker's header
    // is capped at 64 characters by validateHeader), but the function is
    // pure and does not itself assume that, so this exercises the
    // defensive floor at 0 directly.
    const hugeMarker = 'x'.repeat(MAX_COMMENT_BODY_LENGTH)
    const result = buildCommentBody(hugeMarker, 'some report text')
    expect(result.startsWith(hugeMarker)).toBe(true)
    expect(result).toContain('truncated')
  })

  it('never splits a surrogate pair at the truncation boundary', () => {
    // Mirrors body.ts's own private prefix/budget arithmetic, so the pair
    // below lands exactly on the cut point a naive slice() would use.
    const TRUNCATION_NOTICE =
      "\n\n> **Note:** truncated. The full report was over GitHub's comment size limit."
    const prefixLength = MARKER.length + 1
    const budget = MAX_COMMENT_BODY_LENGTH - prefixLength
    const noticeBudget = budget - TRUNCATION_NOTICE.length

    const HIGH_SURROGATE = '\ud83d' // first code unit of an emoji pair
    const LOW_SURROGATE = '\ude00' // second code unit of the same pair
    const body =
      'x'.repeat(noticeBudget - 1) +
      HIGH_SURROGATE +
      LOW_SURROGATE +
      'x'.repeat(1000)

    const result = buildCommentBody(MARKER, body)

    expect(hasUnpairedSurrogate(result)).toBe(false)
  })
})

/** True when `text` contains a high or low surrogate with no matching partner next to it. */
function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const isHigh = code >= 0xd800 && code <= 0xdbff
    const isLow = code >= 0xdc00 && code <= 0xdfff
    if (isHigh) {
      const next = text.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
    } else if (isLow) {
      const prev = text.charCodeAt(i - 1)
      if (!(prev >= 0xd800 && prev <= 0xdbff)) return true
    }
  }
  return false
}
