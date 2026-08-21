import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from '@jest/globals'
import { parse } from 'yaml'
import {
  DEFAULT_CHANGED_SINCE,
  DEFAULT_PROFILE
} from '../../src/actions/get-shards/args.js'

interface ActionYaml {
  inputs?: Record<string, { default?: unknown }>
}

const actionYmlPath = join(
  import.meta.dirname,
  '../../actions/get-shards/action.yml'
)
const actionYaml = parse(readFileSync(actionYmlPath, 'utf8')) as ActionYaml

describe('action.yml matches the code-side defaults', () => {
  it('declares a profile default matching the source of truth', () => {
    expect(actionYaml.inputs?.profile?.default).toBe(DEFAULT_PROFILE)
  })

  it('declares a changed-since default matching the source of truth', () => {
    expect(actionYaml.inputs?.['changed-since']?.default).toBe(
      DEFAULT_CHANGED_SINCE
    )
  })
})
