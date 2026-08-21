import { afterEach, describe, expect, it } from '@jest/globals'
import { getInputOrDefault } from '../../src/lib/optional-input.js'

const ENV_NAME = 'INPUT_CHANGED-SINCE'
const originalValue = process.env[ENV_NAME]

afterEach(() => {
  if (originalValue === undefined) delete process.env[ENV_NAME]
  else process.env[ENV_NAME] = originalValue
})

describe('getInputOrDefault', () => {
  it('returns the fallback when the input is absent', () => {
    delete process.env[ENV_NAME]
    expect(getInputOrDefault('changed-since', 'HEAD^')).toBe('HEAD^')
  })

  it('returns an explicit empty value as empty, not the fallback', () => {
    process.env[ENV_NAME] = ''
    expect(getInputOrDefault('changed-since', 'HEAD^')).toBe('')
  })

  it('returns a supplied value, trimmed', () => {
    process.env[ENV_NAME] = '  main  '
    expect(getInputOrDefault('changed-since', 'HEAD^')).toBe('main')
  })
})
