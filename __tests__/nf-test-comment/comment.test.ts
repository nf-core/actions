import { describe, expect, it } from '@jest/globals'
import {
  buildComment,
  buildResolvedComment
} from '../../src/actions/nf-test-comment/comment.js'

describe('buildComment', () => {
  it('lists every fragment and links the full run', () => {
    const body = buildComment(
      [
        '* `docker` | `latest` | shard 1/2',
        '* `singularity` | `latest` | shard 2/2'
      ],
      'https://example.com/run/1'
    )
    expect(body).toContain('* `docker` | `latest` | shard 1/2')
    expect(body).toContain('* `singularity` | `latest` | shard 2/2')
    expect(body).toContain('https://example.com/run/1')
  })

  it('is a note-style admonition, not a warning', () => {
    expect(buildComment(['* one'], 'https://example.com')).toContain(
      '> [!NOTE]'
    )
  })

  it('caps the listed fragments and notes how many were omitted', () => {
    const fragments = Array.from(
      { length: 250 },
      (_, i) => `* leg ${String(i)}`
    )
    const body = buildComment(fragments, 'https://example.com')

    expect(body).toContain('* leg 0')
    expect(body).toContain('* leg 199')
    expect(body).not.toContain('* leg 200')
    expect(body).toContain('and 50 more')
  })

  it('does not add an omitted note when every fragment fits', () => {
    const body = buildComment(['* one', '* two'], 'https://example.com')
    expect(body).not.toContain('more.')
  })
})

describe('buildResolvedComment', () => {
  it('states that nf-test now passes and links the run', () => {
    const body = buildResolvedComment('https://example.com/run/1')
    expect(body).toContain('now passes')
    expect(body).toContain('https://example.com/run/1')
  })

  it('is a short, single-paragraph note', () => {
    const body = buildResolvedComment('https://example.com')
    expect(body.trim().split('\n')).toHaveLength(1)
  })
})
