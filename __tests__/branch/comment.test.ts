import { describe, expect, it } from '@jest/globals'
import { buildComment } from '../../src/actions/branch/comment.js'

describe('buildComment', () => {
  it('states the base branch and the canonical repository', () => {
    const comment = buildComment('master', 'nf-core/rnaseq', 'a-contributor')
    expect(comment).toContain('`master`')
    expect(comment).toContain('nf-core/rnaseq')
    expect(comment).toContain('dev')
  })

  it('mentions the pull request author', () => {
    const comment = buildComment('master', 'nf-core/rnaseq', 'a-contributor')
    expect(comment).toContain('@a-contributor')
  })
})
