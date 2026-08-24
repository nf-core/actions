// Only '@actions/core' is mocked: comment.ts, fragments.ts and artifact.ts
// already have their own direct, unmocked tests. This exercises the wiring
// between them, using real temporary directories for the fragments and the
// artifact.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'

const getInput =
  jest.fn<(name: string, options?: { required?: boolean }) => string>()
const info = jest.fn()
const write = jest.fn(() => Promise.resolve())
const summary: Record<string, jest.Mock> = {}
summary.addHeading = jest.fn(() => summary)
summary.addRaw = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({ getInput, info, summary }))

const { run } = await import('../../src/actions/nf-test-comment/run.js')

describe('nf-test-comment run()', () => {
  let root: string
  let fragmentsDir: string
  let artifactDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nf-test-comment-run-'))
    fragmentsDir = join(root, 'fragments')
    artifactDir = join(root, 'pr-comment')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function setInputs(overrides: Record<string, string> = {}): void {
    const values: Record<string, string> = {
      'fragments-path': fragmentsDir,
      'run-url': 'https://example.com/run/1',
      'pr-number': '42',
      'artifact-path': artifactDir,
      ...overrides
    }
    getInput.mockImplementation((name, options) => {
      const value = values[name] ?? ''
      if (options?.required && !value) {
        throw new Error(`Input required and not supplied: ${name}`)
      }
      return value
    })
  }

  function comment(): string | undefined {
    const path = join(artifactDir, 'comment.md')
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  }

  function resolved(): string | undefined {
    const path = join(artifactDir, 'resolved.md')
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  }

  it('writes resolved.md and no comment.md when no fragment exists', async () => {
    setInputs()

    await run()

    expect(readFileSync(join(artifactDir, 'pr_number.txt'), 'utf8')).toBe('42')
    expect(readFileSync(join(artifactDir, 'header.txt'), 'utf8')).toBe(
      'nf-test-latest'
    )
    expect(comment()).toBeUndefined()
    expect(resolved()).toContain('now passes')
  })

  it('writes comment.md and no resolved.md when a fragment exists', async () => {
    mkdirSync(fragmentsDir, { recursive: true })
    writeFileSync(
      join(fragmentsDir, '0.md'),
      '* `docker` | `latest` | shard 1/1\n'
    )
    setInputs()

    await run()

    expect(comment()).toContain('`docker` | `latest` | shard 1/1')
    expect(resolved()).toBeUndefined()
  })

  it('combines every fragment file into one comment', async () => {
    mkdirSync(fragmentsDir, { recursive: true })
    writeFileSync(join(fragmentsDir, '0.md'), '* leg a\n')
    writeFileSync(join(fragmentsDir, '1.md'), '* leg b\n')
    setInputs()

    await run()

    expect(comment()).toContain('* leg a')
    expect(comment()).toContain('* leg b')
  })

  it('fails when pr-number is not a positive integer', async () => {
    setInputs({ 'pr-number': '0' })

    await expect(run()).rejects.toThrow(/positive integer/)
  })
})
