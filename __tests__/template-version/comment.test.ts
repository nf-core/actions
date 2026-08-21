import { describe, expect, it } from '@jest/globals'
import {
  buildComment,
  buildResolvedComment
} from '../../src/actions/template-version/comment.js'

describe('buildComment', () => {
  it('states both versions and links the synchronisation docs', () => {
    const body = buildComment('4.0.3', '4.1.0')
    expect(body).toContain('4.0.3')
    expect(body).toContain('4.1.0')
    expect(body).toContain(
      'https://nf-co.re/docs/developing/template-syncs/overview'
    )
  })

  it('is a GitHub warning-style admonition', () => {
    expect(buildComment('4.0.3', '4.1.0')).toContain('> [!WARNING]')
  })
})

describe('buildResolvedComment', () => {
  it('states the latest release', () => {
    expect(buildResolvedComment('4.1.0')).toContain('4.1.0')
  })

  it('is a short, single-paragraph note, not an admonition', () => {
    const body = buildResolvedComment('4.1.0')
    expect(body).not.toContain('[!')
    expect(body.trim().split('\n')).toHaveLength(1)
  })
})
