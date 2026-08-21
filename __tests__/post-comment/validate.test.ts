import { describe, expect, it } from '@jest/globals'
import {
  validateHeader,
  validatePrNumber
} from '../../src/actions/post-comment/validate.js'

describe('validateHeader', () => {
  it('accepts a real header used by a producer in this repo', () => {
    expect(validateHeader('lint')).toBe('lint')
  })

  it('accepts hyphens and digits after the first letter', () => {
    expect(validateHeader('template-version-2')).toBe('template-version-2')
  })

  it('trims a trailing newline from the file content', () => {
    expect(validateHeader('lint\n')).toBe('lint')
  })

  it('rejects an empty header', () => {
    expect(() => validateHeader('')).toThrow(/header\.txt must match/)
  })

  it('rejects a header starting with a digit', () => {
    expect(() => validateHeader('1lint')).toThrow(/header\.txt must match/)
  })

  it('rejects a header with an uppercase letter', () => {
    expect(() => validateHeader('Lint')).toThrow(/header\.txt must match/)
  })

  it('rejects a header with a character outside the allowed set', () => {
    expect(() => validateHeader('lint!')).toThrow(/header\.txt must match/)
  })

  it('rejects a header carrying markup that could break the marker', () => {
    expect(() => validateHeader('lint --><script>')).toThrow(
      /header\.txt must match/
    )
  })

  it('rejects a header over 64 characters', () => {
    expect(() => validateHeader('a'.repeat(65))).toThrow(
      /header\.txt must match/
    )
  })

  it('accepts a header of exactly 64 characters', () => {
    const header = `a${'b'.repeat(63)}`
    expect(validateHeader(header)).toBe(header)
  })
})

describe('validatePrNumber', () => {
  it('parses a plain positive integer', () => {
    expect(validatePrNumber('42')).toBe(42)
  })

  it('trims a trailing newline from the file content', () => {
    expect(validatePrNumber('42\n')).toBe(42)
  })

  it('rejects zero', () => {
    expect(() => validatePrNumber('0')).toThrow(/positive integer/)
  })

  it('rejects a leading zero', () => {
    expect(() => validatePrNumber('042')).toThrow(/positive integer/)
  })

  it('rejects a negative number', () => {
    expect(() => validatePrNumber('-1')).toThrow(/positive integer/)
  })

  it('rejects a non-numeric value', () => {
    expect(() => validatePrNumber('12; rm -rf /')).toThrow(/positive integer/)
  })

  it('rejects a value with trailing text after the digits', () => {
    expect(() => validatePrNumber('12abc')).toThrow(/positive integer/)
  })

  it('rejects an empty value', () => {
    expect(() => validatePrNumber('')).toThrow(/positive integer/)
  })
})
