// Wiring only: writePrCommentArtifact() itself is tested directly in
// __tests__/lib/pr-comment-artifact.test.ts. This just checks that HEADER is
// what post-comment requires, and that writeArtifact() passes it through.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import {
  HEADER,
  writeArtifact
} from '../../src/actions/nf-test-comment/artifact.js'

describe('nf-test-comment writeArtifact', () => {
  let root: string
  let dir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nf-test-comment-artifact-'))
    dir = join(root, 'pr-comment')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('matches the header shape post-comment requires', () => {
    expect(HEADER).toMatch(/^[a-z][a-z0-9-]{0,63}$/)
  })

  it('is distinct from the other headers this repo writes', () => {
    expect(['lint', 'branch', 'template-version']).not.toContain(HEADER)
  })

  it('writes header.txt as HEADER', () => {
    writeArtifact(dir, '42')
    expect(readFileSync(join(dir, 'header.txt'), 'utf8')).toBe(HEADER)
  })
})
