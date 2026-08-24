import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { readFragments } from '../../src/actions/nf-test-comment/fragments.js'

describe('readFragments', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nf-test-comment-fragments-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty array when the directory does not exist', () => {
    expect(readFragments(join(dir, 'missing'))).toEqual([])
  })

  it('returns an empty array for an empty directory', () => {
    expect(readFragments(dir)).toEqual([])
  })

  it('reads every file, trimmed, in filename order', () => {
    writeFileSync(join(dir, '2.md'), '* second\n')
    writeFileSync(join(dir, '1.md'), '* first\n')

    expect(readFragments(dir)).toEqual(['* first', '* second'])
  })

  it('drops a blank file', () => {
    writeFileSync(join(dir, '1.md'), '* real')
    writeFileSync(join(dir, '2.md'), '   \n')

    expect(readFragments(dir)).toEqual(['* real'])
  })
})
