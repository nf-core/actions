import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { writePrCommentArtifact } from '../../src/lib/pr-comment-artifact.js'

describe('writePrCommentArtifact', () => {
  let root: string
  let dir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pr-comment-artifact-'))
    // Not created by beforeEach: writePrCommentArtifact() must create it itself.
    dir = join(root, 'pr-comment')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('always writes pr_number.txt and header.txt', () => {
    writePrCommentArtifact(dir, '42', 'lint')
    expect(readFileSync(join(dir, 'pr_number.txt'), 'utf8')).toBe('42')
    expect(readFileSync(join(dir, 'header.txt'), 'utf8')).toBe('lint')
  })

  it('omits comment.md when there is nothing to say', () => {
    writePrCommentArtifact(dir, '42', 'lint')
    expect(existsSync(join(dir, 'comment.md'))).toBe(false)
  })

  it('writes comment.md when a comment is given', () => {
    writePrCommentArtifact(dir, '42', 'lint', 'Outdated.')
    expect(readFileSync(join(dir, 'comment.md'), 'utf8')).toBe('Outdated.')
  })

  it('omits resolved.md when there is nothing to resolve', () => {
    writePrCommentArtifact(dir, '42', 'lint')
    expect(existsSync(join(dir, 'resolved.md'))).toBe(false)
  })

  it('writes resolved.md when a resolved body is given', () => {
    writePrCommentArtifact(dir, '42', 'lint', undefined, 'Up to date now.')
    expect(readFileSync(join(dir, 'resolved.md'), 'utf8')).toBe(
      'Up to date now.'
    )
  })

  it('writes comment.md and resolved.md together when both are given', () => {
    writePrCommentArtifact(dir, '42', 'lint', 'Outdated.', 'Up to date now.')
    expect(readFileSync(join(dir, 'comment.md'), 'utf8')).toBe('Outdated.')
    expect(readFileSync(join(dir, 'resolved.md'), 'utf8')).toBe(
      'Up to date now.'
    )
  })

  it('creates the directory when it does not already exist', () => {
    expect(existsSync(dir)).toBe(false)
    writePrCommentArtifact(dir, '1', 'lint')
    expect(existsSync(dir)).toBe(true)
  })
})
