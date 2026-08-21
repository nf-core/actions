import { describe, expect, it, jest } from '@jest/globals'

const info = jest.fn()

jest.unstable_mockModule('@actions/core', () => ({ info }))

const getExecOutput =
  jest.fn<
    (
      commandLine: string,
      args?: string[],
      options?: Record<string, unknown>
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  >()

jest.unstable_mockModule('@actions/exec', () => ({ getExecOutput }))

const which = jest.fn<() => Promise<string>>()

jest.unstable_mockModule('@actions/io', () => ({ which }))

const { runNfTest } = await import('../../src/lib/run-nf-test.js')

describe('runNfTest', () => {
  it('throws an install-first message and never runs nf-test when it is missing from PATH', async () => {
    which.mockResolvedValue('')
    await expect(runNfTest(['test'])).rejects.toThrow(
      /nf-test is not on PATH.*install it before this action runs/s
    )
    expect(getExecOutput).not.toHaveBeenCalled()
  })

  it('runs nf-test with the given args, silently, ignoring its return code', async () => {
    which.mockResolvedValue('/usr/bin/nf-test')
    getExecOutput.mockResolvedValue({
      stdout: 'out',
      stderr: 'err',
      exitCode: 1
    })

    const result = await runNfTest(['test', '--profile=+docker'])

    expect(result).toEqual({ stdout: 'out', stderr: 'err', exitCode: 1 })
    expect(getExecOutput).toHaveBeenCalledWith(
      'nf-test',
      ['test', '--profile=+docker'],
      { ignoreReturnCode: true, silent: true }
    )
  })

  it('logs the args JSON-encoded, so an untrusted newline cannot inject a workflow command', async () => {
    which.mockResolvedValue('/usr/bin/nf-test')
    getExecOutput.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

    await runNfTest(['test', '--tag', 'foo\ninjected'])

    const runningLine = info.mock.calls
      .map((call) => call[0] as string)
      .find((message) => message.includes('Running:'))
    expect(runningLine).toBeDefined()
    expect(runningLine).not.toContain('\ninjected')
    expect(runningLine).toContain('\\n')
  })
})
