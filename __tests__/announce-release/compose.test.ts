import { describe, expect, it } from '@jest/globals'
import {
  composeAnnouncement,
  type ComposeOptions,
  type ReleasePayload
} from '../../src/actions/announce-release/compose.js'

const OPTIONS: ComposeOptions = {
  pipelineName: 'rnaseq',
  repository: 'nf-core/rnaseq',
  maxLength: 500
}

function payload(overrides: Partial<ReleasePayload> = {}): ReleasePayload {
  return {
    tagName: '3.14.0',
    releaseName: '',
    body: '',
    htmlUrl: 'https://github.com/nf-core/rnaseq/releases/tag/3.14.0',
    prerelease: false,
    ...overrides
  }
}

describe('composeAnnouncement', () => {
  it('includes the pipeline name, tag, and link for a plain release', () => {
    const text = composeAnnouncement(payload(), OPTIONS)
    expect(text).toContain('rnaseq')
    expect(text).toContain('3.14.0')
    expect(text).toContain('has been released')
    expect(text).toContain(
      'https://github.com/nf-core/rnaseq/releases/tag/3.14.0'
    )
    expect(text).toContain('#nfcore')
    expect(text.length).toBeLessThanOrEqual(OPTIONS.maxLength)
  })

  it('strips a leading v from the tag for display', () => {
    const text = composeAnnouncement(payload({ tagName: 'v3.14.0' }), OPTIONS)
    expect(text).toContain('3.14.0')
    expect(text).not.toContain('v3.14.0')
  })

  it('falls back to the repository name when pipeline-name is empty', () => {
    const text = composeAnnouncement(payload(), {
      ...OPTIONS,
      pipelineName: ''
    })
    expect(text).toContain('rnaseq')
  })

  it('marks a pre-release differently from a stable release', () => {
    const stable = composeAnnouncement(payload({ prerelease: false }), OPTIONS)
    const pre = composeAnnouncement(payload({ prerelease: true }), OPTIONS)
    expect(stable).toContain('has been released')
    expect(pre).toContain('pre-release is available')
    expect(pre).not.toBe(stable)
  })

  describe('a release with no body', () => {
    it('omits an empty body section entirely, with no stray blank block', () => {
      const text = composeAnnouncement(payload({ body: '' }), OPTIONS)
      expect(text).not.toMatch(/\n{3,}/)
      // Head line, then straight to the link and hashtags: three blocks,
      // not four, confirms no empty body block was inserted between them.
      expect(text.split('\n\n')).toHaveLength(3)
    })

    it('treats a whitespace-only body the same as an empty one', () => {
      const text = composeAnnouncement(payload({ body: '   \n\t  ' }), OPTIONS)
      expect(text.split('\n\n')).toHaveLength(3)
    })
  })

  describe('a release with a title', () => {
    it('appends the title when it differs from the tag', () => {
      const text = composeAnnouncement(
        payload({ releaseName: 'The Big One' }),
        OPTIONS
      )
      expect(text).toContain('The Big One')
    })

    /** Only the head line (the first block): the release URL also contains '3.14.0'. */
    function headLineOccurrences(text: string): number {
      const headLine = text.split('\n\n')[0] ?? ''
      return headLine.split('3.14.0').length - 1
    }

    it('does not repeat the title when it is the same as the tag', () => {
      const text = composeAnnouncement(
        payload({ tagName: 'v3.14.0', releaseName: '3.14.0' }),
        OPTIONS
      )
      expect(headLineOccurrences(text)).toBe(1)
    })

    it('does not repeat a v-prefixed title on a v-prefixed tag', () => {
      // GitHub's own release UI pre-fills the title from the tag, so a
      // 'v3.14.0' tag commonly gets a 'v3.14.0' title, not a '3.14.0' one.
      const text = composeAnnouncement(
        payload({ tagName: 'v3.14.0', releaseName: 'v3.14.0' }),
        OPTIONS
      )
      expect(headLineOccurrences(text)).toBe(1)
      expect(text.split('\n\n')[0]).not.toContain('v3.14.0')
    })

    it('appends a title that genuinely differs from the tag, v-prefix aside', () => {
      const text = composeAnnouncement(
        payload({ tagName: 'v3.14.0', releaseName: 'v3.14.1' }),
        OPTIONS
      )
      const headLine = text.split('\n\n')[0] ?? ''
      expect(headLine).toContain('3.14.0')
      expect(headLine).toContain('v3.14.1')
    })
  })

  describe('a body containing markup and control characters', () => {
    it('degrades markdown to plain text and drops control characters', () => {
      const body = [
        '# Heading',
        '',
        'Some **bold**, some _italic_, and `code`.',
        '',
        '- item one',
        '- item two',
        '',
        'See [the changelog](https://example.com/changelog).',
        '\x07\x1bcontrol chars here\x7f'
      ].join('\n')

      const text = composeAnnouncement(payload({ body }), OPTIONS)

      expect(text).not.toContain('**')
      expect(text).not.toContain('# Heading')
      expect(text).not.toContain('`code`')
      expect(text).toContain('Heading')
      expect(text).toContain('bold')
      expect(text).toContain('italic')
      expect(text).toContain('code')
      expect(text).toContain('• item one')
      expect(text).toContain('the changelog (https://example.com/changelog)')
      // eslint-disable-next-line no-control-regex
      expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)).toBe(false)
    })

    it('degrades the double-underscore bold variant too', () => {
      const text = composeAnnouncement(
        payload({ body: 'a __strong__ point' }),
        OPTIONS
      )
      expect(text).not.toContain('__')
      expect(text).toContain('strong')
    })

    it('leaves a snake_case parameter name untouched', () => {
      const text = composeAnnouncement(
        payload({ body: 'Removed the --skip_pseudo_alignment parameter.' }),
        OPTIONS
      )
      expect(text).toContain('--skip_pseudo_alignment')
    })

    it('leaves a URL containing underscores untouched', () => {
      const text = composeAnnouncement(
        payload({
          body: 'See https://example.com/docs/some_page_name for details.'
        }),
        OPTIONS
      )
      expect(text).toContain('https://example.com/docs/some_page_name')
    })

    it('still degrades genuine asterisk italics', () => {
      const text = composeAnnouncement(
        payload({ body: 'This is *important* to note.' }),
        OPTIONS
      )
      expect(text).not.toContain('*important*')
      expect(text).toContain('important')
    })

    it('turns an empty-label markdown link into a bare URL', () => {
      const text = composeAnnouncement(
        payload({ body: 'See [](https://example.com/changelog).' }),
        OPTIONS
      )
      expect(text).toContain('https://example.com/changelog')
      expect(text).not.toContain('[]')
    })

    it('never crashes, whatever shape the control characters take', () => {
      const body = Array.from({ length: 32 }, (_, i) =>
        String.fromCharCode(i)
      ).join('')
      expect(() =>
        composeAnnouncement(payload({ body }), OPTIONS)
      ).not.toThrow()
    })
  })

  describe('a long body', () => {
    it('truncates the body, keeps the link and hashtags, and stays within maxLength', () => {
      const body = 'Lorem ipsum dolor sit amet. '.repeat(200)
      const text = composeAnnouncement(payload({ body }), OPTIONS)

      expect(text.length).toBeLessThanOrEqual(OPTIONS.maxLength)
      expect(text).toContain('…')
      expect(text).toContain(
        'https://github.com/nf-core/rnaseq/releases/tag/3.14.0'
      )
      expect(text).toContain('#nfcore')
    })

    it('never splits a surrogate pair when truncating a long body', () => {
      const HIGH_SURROGATE = '\ud83d'
      const LOW_SURROGATE = '\ude00'
      const filler =
        'x'.repeat(490) + HIGH_SURROGATE + LOW_SURROGATE + 'y'.repeat(20)
      const text = composeAnnouncement(payload({ body: filler }), OPTIONS)

      expect(hasUnpairedSurrogate(text)).toBe(false)
    })

    it('drops the body entirely, but keeps the skeleton intact, when there is no room for any of it', () => {
      // The skeleton (head line, link, hashtags) with no body at all, at a
      // generous length: this is exactly what a maxLength just one
      // character above the skeleton's own length should still produce,
      // even with a huge body supplied.
      const skeleton = composeAnnouncement(payload({ body: '' }), {
        ...OPTIONS,
        maxLength: 100000
      })
      const body = 'Lorem ipsum dolor sit amet. '.repeat(200)
      const tightOptions: ComposeOptions = {
        ...OPTIONS,
        maxLength: skeleton.length + 1
      }
      const text = composeAnnouncement(payload({ body }), tightOptions)

      expect(text).toBe(skeleton)
      expect(text).toContain(
        'https://github.com/nf-core/rnaseq/releases/tag/3.14.0'
      )
    })

    it('truncates even the skeleton, without throwing, when maxLength is smaller than it', () => {
      const tinyOptions: ComposeOptions = { ...OPTIONS, maxLength: 10 }
      expect(() => composeAnnouncement(payload(), tinyOptions)).not.toThrow()
      const text = composeAnnouncement(payload(), tinyOptions)
      expect(text.length).toBeLessThanOrEqual(tinyOptions.maxLength)
    })
  })

  describe('a long release title, at a small maxLength', () => {
    const tightOptions: ComposeOptions = { ...OPTIONS, maxLength: 300 }
    const longTitle = 'A'.repeat(250)

    it('keeps the release URL and the hashtags, shrinking the title instead', () => {
      const text = composeAnnouncement(
        payload({ releaseName: longTitle }),
        tightOptions
      )

      expect(text.length).toBeLessThanOrEqual(tightOptions.maxLength)
      expect(text).toContain(
        'https://github.com/nf-core/rnaseq/releases/tag/3.14.0'
      )
      expect(text).toContain('#nfcore #openscience #nextflow #bioinformatics')
      expect(text).toContain('…')
      expect(text).not.toContain(longTitle)
    })

    it('truncates even the base head line as a last resort, keeping the footer', () => {
      // Unreachable at any realistic maxLength or pipeline-name, but the
      // footer must still win even when the pipeline name alone is longer
      // than the whole budget.
      const text = composeAnnouncement(payload(), {
        pipelineName: 'X'.repeat(400),
        repository: 'nf-core/rnaseq',
        maxLength: 200
      })

      expect(text.length).toBeLessThanOrEqual(200)
      expect(text).toContain(
        'https://github.com/nf-core/rnaseq/releases/tag/3.14.0'
      )
      expect(text).toContain('#nfcore #openscience #nextflow #bioinformatics')
    })

    it('sacrifices the body before the title, matching README.md', () => {
      // At this maxLength the title alone leaves no room for any body:
      // the documented order (body first, then title, URL and hashtags
      // last) means the body vanishes and the title still survives, at
      // least in shortened form.
      const text = composeAnnouncement(
        payload({
          releaseName: longTitle,
          body: 'Some release notes that would not fit.'
        }),
        tightOptions
      )

      expect(text).not.toContain('release notes')
      expect(text).toContain(
        'https://github.com/nf-core/rnaseq/releases/tag/3.14.0'
      )
      expect(text).toContain('#nfcore #openscience #nextflow #bioinformatics')
    })
  })

  describe('the boundary of maxLength', () => {
    it('does not truncate a body that lands exactly on maxLength', () => {
      const base = composeAnnouncement(payload({ body: '' }), {
        ...OPTIONS,
        maxLength: 100000
      })
      const withBody = composeAnnouncement(payload({ body: 'x'.repeat(10) }), {
        ...OPTIONS,
        maxLength: base.length + '\n\n'.length + 10
      })
      expect(withBody).not.toContain('…')
      expect(withBody.length).toBe(base.length + '\n\n'.length + 10)
    })

    it('truncates a body that is exactly one character over maxLength', () => {
      const base = composeAnnouncement(payload({ body: '' }), {
        ...OPTIONS,
        maxLength: 100000
      })
      const exactLength = base.length + '\n\n'.length + 10
      const withBody = composeAnnouncement(payload({ body: 'x'.repeat(11) }), {
        ...OPTIONS,
        maxLength: exactLength
      })
      expect(withBody).toContain('…')
      expect(withBody.length).toBeLessThanOrEqual(exactLength)
    })
  })

  describe('a tag that does not match the expected shape', () => {
    it('announces an arbitrary, non-version tag as-is', () => {
      const text = composeAnnouncement(
        payload({ tagName: 'not-a-version' }),
        OPTIONS
      )
      expect(text).toContain('not-a-version')
    })

    it('handles an empty tag without crashing or leaving a double space', () => {
      const text = composeAnnouncement(payload({ tagName: '' }), OPTIONS)
      expect(text).not.toMatch(/ {2,}/)
      expect(text).toContain('rnaseq')
    })

    it('strips control characters out of an odd tag', () => {
      const text = composeAnnouncement(
        payload({ tagName: 'v1\x07.0\x1b' }),
        OPTIONS
      )
      // eslint-disable-next-line no-control-regex
      expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)).toBe(false)
    })
  })
})

/** True when `text` contains a high or low surrogate with no matching partner next to it. */
function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const isHigh = code >= 0xd800 && code <= 0xdbff
    const isLow = code >= 0xdc00 && code <= 0xdfff
    if (isHigh) {
      const next = text.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
    } else if (isLow) {
      const prev = text.charCodeAt(i - 1)
      if (!(prev >= 0xd800 && prev <= 0xdbff)) return true
    }
  }
  return false
}
