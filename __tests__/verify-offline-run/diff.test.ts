import { describe, expect, it } from '@jest/globals'
import {
  newEntries,
  parseFileList
} from '../../src/actions/verify-offline-run/diff.js'

describe('parseFileList', () => {
  it('splits lines, trims, drops blanks, dedupes, and sorts', () => {
    expect(parseFileList('b.sif\n\n a.sif \na.sif\n')).toEqual([
      'a.sif',
      'b.sif'
    ])
  })

  it('returns an empty array for an empty listing', () => {
    expect(parseFileList('')).toEqual([])
    expect(parseFileList('\n')).toEqual([])
  })
})

describe('newEntries', () => {
  it('returns entries present after but not before', () => {
    expect(newEntries(['a.sif'], ['a.sif', 'b.sif'])).toEqual(['b.sif'])
  })

  it('returns an empty array when nothing new appeared', () => {
    expect(newEntries(['a.sif', 'b.sif'], ['a.sif'])).toEqual([])
    expect(newEntries([], [])).toEqual([])
  })

  it('does not treat a removed entry as a new one', () => {
    expect(newEntries(['a.sif', 'b.sif'], ['a.sif'])).toEqual([])
  })
})
