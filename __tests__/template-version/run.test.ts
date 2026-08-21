// Only the network layer is mocked ('@actions/core' and '@actions/github'):
// version.ts, comment.ts and artifact.ts already have their own direct,
// unmocked tests. This exercises the wiring between them, using a real
// temporary directory for the artifact.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
const warning = jest.fn()
const write = jest.fn(() => Promise.resolve())
const summary: Record<string, jest.Mock> = {}
summary.addHeading = jest.fn(() => summary)
summary.addTable = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({
  getInput,
  info,
  warning,
  summary
}))

const getLatestRelease =
  jest.fn<(params: unknown) => Promise<{ data: { tag_name: string } }>>()
const getOctokit = jest.fn(() => ({
  rest: { repos: { getLatestRelease } }
}))

jest.unstable_mockModule('@actions/github', () => ({ getOctokit }))

const { run } = await import('../../src/actions/template-version/run.js')

describe('template-version run()', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'template-version-run-'))
    getLatestRelease.mockResolvedValue({ data: { tag_name: '4.1.0' } })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function setInputs(overrides: Record<string, string> = {}): void {
    const values: Record<string, string> = {
      'nf-core-version': '4.0.3',
      'pr-number': '42',
      'github-token': 'a-token',
      'artifact-path': dir,
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
    const path = join(dir, 'comment.md')
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  }

  function resolved(): string | undefined {
    const path = join(dir, 'resolved.md')
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  }

  it('writes a comment when the pipeline is behind the latest release', async () => {
    setInputs({ 'nf-core-version': '4.0.3' })

    await run()

    expect(readFileSync(join(dir, 'pr_number.txt'), 'utf8')).toBe('42')
    expect(readFileSync(join(dir, 'header.txt'), 'utf8')).toBe(
      'template-version'
    )
    expect(comment()).toContain('4.0.3')
    expect(comment()).toContain('4.1.0')
  })

  it('writes no comment.md when the pipeline is already up to date', async () => {
    setInputs({ 'nf-core-version': '4.1.0' })

    await run()

    expect(comment()).toBeUndefined()
  })

  it('writes resolved.md, stating the latest release, when the pipeline is up to date', async () => {
    setInputs({ 'nf-core-version': '4.1.0' })

    await run()

    expect(resolved()).toContain('4.1.0')
  })

  it('writes no resolved.md when the pipeline is behind', async () => {
    setInputs({ 'nf-core-version': '4.0.3' })

    await run()

    expect(resolved()).toBeUndefined()
  })

  it('writes no resolved.md when the pipeline version is missing', async () => {
    setInputs({ 'nf-core-version': '' })

    await run()

    expect(resolved()).toBeUndefined()
  })

  it('writes no comment.md and warns when the pipeline version is missing', async () => {
    setInputs({ 'nf-core-version': '' })

    await run()

    expect(comment()).toBeUndefined()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('not set'))
  })

  it('never carries a pull-request-controlled value into resolved.md', async () => {
    // Same class of payload as item 1's injection test: coerces to '4.1.0',
    // which compares up-to-date against latest '4.1.0'. resolved.md states
    // only the trusted latest release, never the pipeline's own raw value.
    setInputs({ 'nf-core-version': '4.1.0\n\n> [!CAUTION]\n> hi' })

    await run()

    expect(resolved()).toContain('4.1.0')
    expect(resolved()).not.toContain('CAUTION')
  })

  it('fails when pr-number is not a positive integer', async () => {
    setInputs({ 'pr-number': '0' })

    await expect(run()).rejects.toThrow(/positive integer/)
  })
})
