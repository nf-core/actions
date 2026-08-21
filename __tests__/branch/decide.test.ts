import { describe, expect, it } from '@jest/globals'
import {
  isAllowedSource,
  isReleaseBranch
} from '../../src/actions/branch/decide.js'

const CANONICAL = 'nf-core/rnaseq'

describe('isAllowedSource', () => {
  it('allows dev from the canonical repository', () => {
    expect(
      isAllowedSource({
        headRepo: CANONICAL,
        headRef: 'dev',
        canonicalRepo: CANONICAL
      })
    ).toBe(true)
  })

  it('allows patch from the canonical repository', () => {
    expect(
      isAllowedSource({
        headRepo: CANONICAL,
        headRef: 'patch',
        canonicalRepo: CANONICAL
      })
    ).toBe(true)
  })

  it('blocks dev from a fork', () => {
    expect(
      isAllowedSource({
        headRepo: 'someone/rnaseq',
        headRef: 'dev',
        canonicalRepo: CANONICAL
      })
    ).toBe(false)
  })

  it('blocks a branch literally named patch from a fork', () => {
    // The gap the vendored check had: 'patch' alone, from any repository,
    // used to pass. See decide.ts's own doc comment.
    expect(
      isAllowedSource({
        headRepo: 'someone/rnaseq',
        headRef: 'patch',
        canonicalRepo: CANONICAL
      })
    ).toBe(false)
  })

  it('blocks an unrelated branch from the canonical repository', () => {
    expect(
      isAllowedSource({
        headRepo: CANONICAL,
        headRef: 'feature-x',
        canonicalRepo: CANONICAL
      })
    ).toBe(false)
  })

  it('is case-sensitive on the head ref', () => {
    expect(
      isAllowedSource({
        headRepo: CANONICAL,
        headRef: 'Dev',
        canonicalRepo: CANONICAL
      })
    ).toBe(false)
  })
})

describe('isReleaseBranch', () => {
  it('allows master', () => {
    expect(isReleaseBranch('master')).toBe(true)
  })

  it('allows main', () => {
    expect(isReleaseBranch('main')).toBe(true)
  })

  it('rejects dev', () => {
    expect(isReleaseBranch('dev')).toBe(false)
  })

  it('rejects an arbitrary branch', () => {
    expect(isReleaseBranch('feature-x')).toBe(false)
  })
})
