// Real filesystem, real temporary directories: reading files is the thing
// under test here.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { readArtifact } from '../../src/actions/post-comment/artifact.js'

describe('readArtifact', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'post-comment-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns undefined when the directory does not exist at all', () => {
    expect(readArtifact(join(dir, 'does-not-exist'))).toBeUndefined()
  })

  it('returns undefined when the directory exists but is empty', () => {
    expect(readArtifact(dir)).toBeUndefined()
  })

  it('reads pr_number.txt, header.txt and comment.md when all three are present', () => {
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'lint\n')
    writeFileSync(join(dir, 'comment.md'), '## Report\n\nAll good.\n')

    expect(readArtifact(dir)).toEqual({
      prNumberRaw: '42\n',
      headerRaw: 'lint\n',
      bodyRaw: '## Report\n\nAll good.\n',
      resolvedRaw: undefined
    })
  })

  it('reads bodyRaw as undefined when comment.md is absent: nothing to say', () => {
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'lint\n')

    expect(readArtifact(dir)).toEqual({
      prNumberRaw: '42\n',
      headerRaw: 'lint\n',
      bodyRaw: undefined,
      resolvedRaw: undefined
    })
  })

  it('reads resolvedRaw when resolved.md is present', () => {
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'lint\n')
    writeFileSync(join(dir, 'resolved.md'), 'Now up to date.\n')

    expect(readArtifact(dir)).toEqual({
      prNumberRaw: '42\n',
      headerRaw: 'lint\n',
      bodyRaw: undefined,
      resolvedRaw: 'Now up to date.\n'
    })
  })

  it('throws when pr_number.txt is present but header.txt is not', () => {
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')

    expect(() => readArtifact(dir)).toThrow(/no header\.txt/)
  })

  it('rejects a symlink instead of following it into whatever it points at', () => {
    const secret = join(dir, 'secret.txt')
    writeFileSync(secret, 'not part of the pr-comment contract')
    symlinkSync(secret, join(dir, 'pr_number.txt'))

    expect(() => readArtifact(dir)).toThrow(/not a regular file/)
    expect(() => readArtifact(dir)).toThrow(/a symlink/)
  })

  it('rejects a symlink standing in for header.txt', () => {
    const secret = join(dir, 'secret.txt')
    writeFileSync(secret, 'not part of the pr-comment contract')
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    symlinkSync(secret, join(dir, 'header.txt'))

    expect(() => readArtifact(dir)).toThrow(/a symlink/)
  })

  it('rejects a symlink standing in for comment.md', () => {
    const secret = join(dir, 'secret.txt')
    writeFileSync(secret, 'not part of the pr-comment contract')
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'lint\n')
    symlinkSync(secret, join(dir, 'comment.md'))

    expect(() => readArtifact(dir)).toThrow(/a symlink/)
  })

  it('rejects a symlink standing in for resolved.md', () => {
    const secret = join(dir, 'secret.txt')
    writeFileSync(secret, 'not part of the pr-comment contract')
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'lint\n')
    symlinkSync(secret, join(dir, 'resolved.md'))

    expect(() => readArtifact(dir)).toThrow(/a symlink/)
  })

  it('rejects an oversized header.txt before reading it into memory', () => {
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'a'.repeat(5000))

    expect(() => readArtifact(dir)).toThrow(/byte cap/)
  })

  it('rejects an oversized comment.md', () => {
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'lint\n')
    writeFileSync(join(dir, 'comment.md'), 'x'.repeat(2 * 1024 * 1024))

    expect(() => readArtifact(dir)).toThrow(/byte cap/)
  })

  it('rejects an oversized resolved.md', () => {
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'lint\n')
    writeFileSync(join(dir, 'resolved.md'), 'x'.repeat(2 * 1024 * 1024))

    expect(() => readArtifact(dir)).toThrow(/byte cap/)
  })

  it('does not swallow a filesystem error other than ENOENT', () => {
    const locked = join(dir, 'locked')
    mkdirSync(locked)
    writeFileSync(join(locked, 'pr_number.txt'), '42\n')
    // No execute permission on the parent: lstat on the file inside it
    // fails with EACCES, not ENOENT.
    chmodSync(locked, 0o000)

    try {
      expect(() => readArtifact(locked)).toThrow(
        expect.objectContaining({ code: 'EACCES' })
      )
    } finally {
      chmodSync(locked, 0o700)
    }
  })

  it('accepts a comment.md well within the cap but larger than a typical report', () => {
    writeFileSync(join(dir, 'pr_number.txt'), '42\n')
    writeFileSync(join(dir, 'header.txt'), 'lint\n')
    const body = 'x'.repeat(200_000)
    writeFileSync(join(dir, 'comment.md'), body)

    expect(readArtifact(dir)?.bodyRaw).toBe(body)
  })
})
