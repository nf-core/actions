// Only '@actions/core' is mocked: decide.ts, comment.ts and artifact.ts
// already have their own direct, unmocked tests. This exercises the wiring
// between them, using a real temporary directory for the artifact.

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
const write = jest.fn(() => Promise.resolve())
const summary: Record<string, jest.Mock> = {}
summary.addHeading = jest.fn(() => summary)
summary.addTable = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({
  getInput,
  info,
  summary
}))

const { run } = await import('../../src/actions/branch/run.js')

describe('branch run()', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'branch-run-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function setInputs(overrides: Record<string, string> = {}): void {
    const values: Record<string, string> = {
      'event-name': 'pull_request',
      'head-repo': 'nf-core/rnaseq',
      'head-ref': 'dev',
      'base-ref': 'master',
      repository: 'nf-core/rnaseq',
      'pr-user': 'a-contributor',
      'pr-number': '42',
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

  function resolvedExists(): boolean {
    return existsSync(join(dir, 'resolved.md'))
  }

  it('writes no comment.md and no resolved.md when the source is allowed', async () => {
    setInputs({ 'head-ref': 'dev' })

    await run()

    expect(readFileSync(join(dir, 'pr_number.txt'), 'utf8')).toBe('42')
    expect(readFileSync(join(dir, 'header.txt'), 'utf8')).toBe('branch')
    expect(comment()).toBeUndefined()
    expect(resolvedExists()).toBe(false)
  })

  it('allows a patch branch from the canonical repository', async () => {
    setInputs({ 'head-ref': 'patch' })

    await run()

    expect(comment()).toBeUndefined()
  })

  it('writes comment.md and no resolved.md, and throws, when the source is a fork', async () => {
    setInputs({ 'head-repo': 'someone/rnaseq', 'head-ref': 'dev' })

    await expect(run()).rejects.toThrow(/nf-core\/rnaseq/)

    expect(comment()).toContain('master')
    expect(resolvedExists()).toBe(false)
  })

  it('writes comment.md and throws for a patch branch on a fork', async () => {
    setInputs({ 'head-repo': 'someone/rnaseq', 'head-ref': 'patch' })

    await expect(run()).rejects.toThrow()

    expect(comment()).toBeDefined()
  })

  it('writes comment.md and throws for an unrelated branch', async () => {
    setInputs({ 'head-ref': 'feature-x' })

    await expect(run()).rejects.toThrow()

    expect(comment()).toBeDefined()
  })

  it('fails when pr-number is not a positive integer', async () => {
    setInputs({ 'pr-number': '0' })

    await expect(run()).rejects.toThrow(/positive integer/)
  })

  it('passes with a logged reason, writing no comment.md, when the base branch is not a release branch', async () => {
    setInputs({ 'base-ref': 'dev', 'head-ref': 'feature-x' })

    await run()

    expect(readFileSync(join(dir, 'pr_number.txt'), 'utf8')).toBe('42')
    expect(comment()).toBeUndefined()
    expect(resolvedExists()).toBe(false)
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('not a release branch')
    )
  })

  it('does not evaluate the source at all for a non-release base branch', async () => {
    // A fork head repository with a disallowed branch would fail the source
    // check on a release base; on a non-release base it must still pass.
    setInputs({
      'base-ref': 'dev',
      'head-repo': 'someone/rnaseq',
      'head-ref': 'feature-x'
    })

    await expect(run()).resolves.toBeUndefined()
  })

  it('fails clearly, naming the event, when the triggering event is not pull_request', async () => {
    setInputs({ 'event-name': 'workflow_dispatch' })

    await expect(run()).rejects.toThrow(/workflow_dispatch.*pull_request/s)
  })
})
