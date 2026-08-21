// Wiring only: writePrCommentArtifact() itself is tested directly in
// __tests__/lib/pr-comment-artifact.test.ts. This just checks that HEADER is
// what post-comment requires, is distinct from the other two producers'
// headers, and that writeArtifact() passes it through.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { HEADER, writeArtifact } from '../../src/actions/branch/artifact.js'

describe('branch writeArtifact', () => {
  let root: string
  let dir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'branch-artifact-'))
    dir = join(root, 'pr-comment')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('matches the header shape post-comment requires', () => {
    expect(HEADER).toMatch(/^[a-z][a-z0-9-]{0,63}$/)
  })

  it('is distinct from the other producers in this repo', () => {
    expect(HEADER).not.toBe('lint')
    expect(HEADER).not.toBe('template-version')
  })

  it('writes header.txt as HEADER', () => {
    writeArtifact(dir, '42')
    expect(readFileSync(join(dir, 'header.txt'), 'utf8')).toBe(HEADER)
  })
})
