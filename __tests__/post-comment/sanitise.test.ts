import { describe, expect, it } from '@jest/globals'
import { buildMarker } from '../../src/actions/post-comment/marker.js'
import { sanitiseBody } from '../../src/actions/post-comment/sanitise.js'

describe('sanitiseBody', () => {
  it('leaves ordinary Markdown untouched', () => {
    const body = '## Report\n\nAll good. See [the docs](https://example.com).'
    expect(sanitiseBody(body)).toBe(body)
  })

  it('wraps a marker lookalike buried mid-body in inline code', () => {
    const lookalike = buildMarker('lint')
    const body = `Some text.\n${lookalike}\nMore text, a different report.`
    const result = sanitiseBody(body)
    expect(result).toContain(`\`${lookalike}\``)
    expect(result).not.toContain(`\n${lookalike}\n`)
  })

  it('wraps a marker lookalike at the very start of the body', () => {
    const lookalike = buildMarker('lint')
    const body = `${lookalike}\nAttacker-controlled report.`
    const result = sanitiseBody(body)
    expect(result.startsWith(lookalike)).toBe(false)
    expect(result).toContain(`\`${lookalike}\``)
  })

  it('renders a plain @mention as inline code', () => {
    expect(sanitiseBody('cc @a-maintainer please review')).toBe(
      'cc `@a-maintainer` please review'
    )
  })

  it('renders an @org/team mention as inline code', () => {
    expect(sanitiseBody('cc @nf-core/core-team')).toBe(
      'cc `@nf-core/core-team`'
    )
  })

  it('turns a markdown image embed into a plain link', () => {
    expect(sanitiseBody('![status](https://example.com/pixel.png)')).toBe(
      '[status](https://example.com/pixel.png)'
    )
  })

  it('escapes a raw <img> tag into visible text', () => {
    const result = sanitiseBody('<img src="https://example.com/pixel.png">')
    expect(result).toBe('&lt;img src="https://example.com/pixel.png"&gt;')
  })

  it('leaves an ordinary link, without a leading !, untouched', () => {
    const body = '[a lint report](https://example.com/report)'
    expect(sanitiseBody(body)).toBe(body)
  })
})
