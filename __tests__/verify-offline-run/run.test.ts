// Real fs against a throwaway temp directory: reading a plain file listing
// is not worth mocking. Only '@actions/core' is mocked.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
summary.addList = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({
  getInput,
  info,
  summary
}))

const { run } = await import('../../src/actions/verify-offline-run/run.js')

describe('verify-offline-run', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-offline-run-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function setInputs(before: string, after: string): void {
    const beforePath = join(dir, 'before.txt')
    const afterPath = join(dir, 'after.txt')
    writeFileSync(beforePath, before)
    writeFileSync(afterPath, after)
    getInput.mockImplementation((name) => {
      if (name === 'before-path') return beforePath
      if (name === 'after-path') return afterPath
      return ''
    })
  }

  it('passes when the cache is unchanged', async () => {
    setInputs('a.sif\nb.sif\n', 'a.sif\nb.sif\n')

    await expect(run()).resolves.toBeUndefined()

    expect(info).toHaveBeenCalledWith(expect.stringContaining('2 container'))
    expect(summary.addList).not.toHaveBeenCalled()
  })

  it('passes when the cache only shrank', async () => {
    setInputs('a.sif\nb.sif\n', 'a.sif\n')

    await expect(run()).resolves.toBeUndefined()
  })

  it('fails and names the image when a new one was pulled at runtime', async () => {
    setInputs('a.sif\n', 'a.sif\nb.sif\n')

    await expect(run()).rejects.toThrow(/b\.sif/)

    expect(summary.addList).toHaveBeenCalledWith(['b.sif'])
  })

  it('escapes an image name before it reaches the job summary', async () => {
    setInputs('', '<img>.sif\n')

    await expect(run()).rejects.toThrow()

    expect(summary.addList).toHaveBeenCalledWith(['&lt;img&gt;.sif'])
  })

  it('fails when the after listing is empty, on both sides', async () => {
    setInputs('', '')

    await expect(run()).rejects.toThrow(/could not verify anything/)
  })

  it('fails when the after listing is empty, even with a non-empty before', async () => {
    setInputs('a.sif\nb.sif\n', '')

    await expect(run()).rejects.toThrow(/could not verify anything/)
  })
})
