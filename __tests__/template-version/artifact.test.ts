import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import {
  HEADER,
  writeArtifact
} from '../../src/actions/template-version/artifact.js'

describe('writeArtifact', () => {
  let root: string
  let dir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'template-version-artifact-'))
    // Not created by beforeEach: writeArtifact() must create it itself.
    dir = join(root, 'pr-comment')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('always writes pr_number.txt and header.txt', () => {
    writeArtifact(dir, '42')
    expect(readFileSync(join(dir, 'pr_number.txt'), 'utf8')).toBe('42')
    expect(readFileSync(join(dir, 'header.txt'), 'utf8')).toBe(HEADER)
  })

  it('matches the header shape post-comment requires', () => {
    expect(HEADER).toMatch(/^[a-z][a-z0-9-]{0,63}$/)
  })

  it('omits comment.md when there is nothing to say', () => {
    writeArtifact(dir, '42')
    expect(existsSync(join(dir, 'comment.md'))).toBe(false)
  })

  it('writes comment.md when a comment is given', () => {
    writeArtifact(dir, '42', 'Outdated.')
    expect(readFileSync(join(dir, 'comment.md'), 'utf8')).toBe('Outdated.')
  })

  it('omits resolved.md when there is nothing to resolve', () => {
    writeArtifact(dir, '42')
    expect(existsSync(join(dir, 'resolved.md'))).toBe(false)
  })

  it('writes resolved.md when a resolved body is given', () => {
    writeArtifact(dir, '42', undefined, 'Up to date now.')
    expect(readFileSync(join(dir, 'resolved.md'), 'utf8')).toBe(
      'Up to date now.'
    )
  })

  it('writes comment.md and resolved.md together when both are given', () => {
    writeArtifact(dir, '42', 'Outdated.', 'Up to date now.')
    expect(readFileSync(join(dir, 'comment.md'), 'utf8')).toBe('Outdated.')
    expect(readFileSync(join(dir, 'resolved.md'), 'utf8')).toBe(
      'Up to date now.'
    )
  })

  it('creates the directory when it does not already exist', () => {
    expect(existsSync(dir)).toBe(false)
    writeArtifact(dir, '1')
    expect(existsSync(dir)).toBe(true)
  })
})
