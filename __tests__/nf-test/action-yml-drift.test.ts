import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from '@jest/globals'
import { parse } from 'yaml'
import { DEFAULT_VERBOSE } from '../../src/actions/nf-test/args.js'

interface ActionYaml {
  inputs?: Record<string, { default?: unknown }>
  outputs?: Record<string, unknown>
}

const actionYmlPath = join(
  import.meta.dirname,
  '../../actions/nf-test/action.yml'
)
const actionYaml = parse(readFileSync(actionYmlPath, 'utf8')) as ActionYaml

describe('action.yml matches the code-side defaults', () => {
  // changed-since has no action.yml default: src/lib/run-nf-test.ts's
  // DEFAULT_CHANGED_SINCE is the only source of truth, applied only when the
  // input is absent (see src/lib/optional-input.ts). Declaring a default
  // here too would let the two drift apart silently.
  it('declares no default for changed-since', () => {
    expect(actionYaml.inputs?.['changed-since']?.default).toBeUndefined()
  })

  it('declares a verbose default matching the source of truth', () => {
    expect(actionYaml.inputs?.verbose?.default).toBe(String(DEFAULT_VERBOSE))
  })
})

describe('action.yml declares every output this action sets', () => {
  it.each([
    'total',
    'passed',
    'failed',
    'todo',
    'skip',
    'skipped',
    'tap-path',
    'exit-code',
    'bailed-out'
  ])('declares %s', (output) => {
    expect(actionYaml.outputs?.[output]).toBeDefined()
  })
})
