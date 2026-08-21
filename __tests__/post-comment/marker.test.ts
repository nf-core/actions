import { describe, expect, it } from '@jest/globals'
import {
  buildMarker,
  MARKER_LOOKALIKE
} from '../../src/actions/post-comment/marker.js'

describe('buildMarker', () => {
  it('wraps the header in a namespaced HTML comment', () => {
    expect(buildMarker('lint')).toBe('<!-- nf-core-actions:pr-comment:lint -->')
  })

  it('gives two different headers two different markers', () => {
    expect(buildMarker('lint')).not.toBe(buildMarker('template-version'))
  })
})

// MARKER_LOOKALIKE carries the 'g' flag and is a shared, module-level
// singleton, so these use String.prototype.match(), not toMatch(): match()
// resets the regex's own lastIndex before it searches, on every call
// (per spec), while toMatch() would call the regex's own .test() directly
// and inherit whatever lastIndex an earlier assertion in this suite left
// behind.
describe('MARKER_LOOKALIKE', () => {
  it('matches a marker this action would itself build', () => {
    expect(buildMarker('lint').match(MARKER_LOOKALIKE)).not.toBeNull()
  })

  it('matches a lookalike for a different, still-valid header', () => {
    expect(
      '<!-- nf-core-actions:pr-comment:template-version -->'.match(
        MARKER_LOOKALIKE
      )
    ).not.toBeNull()
  })

  it('does not match ordinary text', () => {
    expect('All good, no issues found.'.match(MARKER_LOOKALIKE)).toBeNull()
  })

  it('finds every occurrence when there is more than one', () => {
    const text = `${buildMarker('lint')} text ${buildMarker('lint')}`
    expect(text.match(MARKER_LOOKALIKE)).toHaveLength(2)
  })
})
