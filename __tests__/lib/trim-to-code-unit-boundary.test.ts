import { describe, expect, it } from '@jest/globals'
import { trimToCodeUnitBoundary } from '../../src/lib/trim-to-code-unit-boundary.js'

describe('trimToCodeUnitBoundary', () => {
  it('returns text unchanged when it is within the limit', () => {
    expect(trimToCodeUnitBoundary('hello', 10)).toBe('hello')
  })

  it('returns text unchanged when it exactly matches the limit', () => {
    expect(trimToCodeUnitBoundary('hello', 5)).toBe('hello')
  })

  it('cuts plain text to the limit', () => {
    expect(trimToCodeUnitBoundary('hello world', 5)).toBe('hello')
  })

  it('returns an empty string for a zero or negative limit', () => {
    expect(trimToCodeUnitBoundary('hello', 0)).toBe('')
    expect(trimToCodeUnitBoundary('hello', -1)).toBe('')
  })

  it('never splits a surrogate pair at the cut point', () => {
    const HIGH_SURROGATE = '\ud83d' // first code unit of an emoji pair
    const LOW_SURROGATE = '\ude00' // second code unit of the same pair
    const text = 'x' + HIGH_SURROGATE + LOW_SURROGATE + 'y'
    // Cutting at index 2 would land between the two surrogates.
    expect(trimToCodeUnitBoundary(text, 2)).toBe('x')
  })

  it('keeps a complete surrogate pair when the limit lands right after it', () => {
    const HIGH_SURROGATE = '\ud83d'
    const LOW_SURROGATE = '\ude00'
    const text = 'x' + HIGH_SURROGATE + LOW_SURROGATE + 'y'
    expect(trimToCodeUnitBoundary(text, 3)).toBe(
      'x' + HIGH_SURROGATE + LOW_SURROGATE
    )
  })
})
