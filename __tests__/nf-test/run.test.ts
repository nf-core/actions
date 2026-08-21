import { writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const getInput =
  jest.fn<(name: string, options?: { required?: boolean }) => string>()
const info = jest.fn()
const warning = jest.fn()
const setOutput = jest.fn<(name: string, value: string) => void>()
const write = jest.fn(() => Promise.resolve())

// The real Summary API returns `this` from addHeading/addRaw/addTable so
// calls chain, and write() lives on that same instance.
const summary: Record<string, jest.Mock> = {}
summary.addHeading = jest.fn(() => summary)
summary.addRaw = jest.fn(() => summary)
summary.addTable = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({
  getInput,
  info,
  warning,
  setOutput,
  summary
}))

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

// Simulates nf-test: writes `tapContentToWrite` to the path named by the
// '--tap=' argv element (mirroring what the real binary does as a side
// effect), then resolves with the configured result.
let tapContentToWrite: string | undefined
let execResult: ExecResult = { stdout: '', stderr: '', exitCode: 0 }

const getExecOutput = jest.fn(
  async (_commandLine: string, args: string[] = []): Promise<ExecResult> => {
    const tapArg = args.find((arg) => arg.startsWith('--tap='))
    if (tapArg && tapContentToWrite !== undefined) {
      await writeFile(tapArg.slice('--tap='.length), tapContentToWrite)
    }
    return execResult
  }
)

jest.unstable_mockModule('@actions/exec', () => ({ getExecOutput }))

const which = jest.fn<() => Promise<string>>(() =>
  Promise.resolve('/usr/bin/nf-test')
)

jest.unstable_mockModule('@actions/io', () => ({ which }))

const { run } = await import('../../src/actions/nf-test/run.js')

const DEFAULT_INPUTS: Record<string, string> = {
  profile: 'docker',
  shard: '1',
  'total-shards': '3',
  tags: '',
  'changed-since': 'HEAD^',
  verbose: 'true',
  'extra-args': ''
}

// Mirrors @actions/core's real getInput: the 'required' check runs on the
// raw, untrimmed value, but the returned value is always trimmed. A
// whitespace-only input therefore passes the required check and still
// comes back empty, which is why run.ts validates profile itself instead
// of relying on { required: true } alone.
function setInputs(overrides: Record<string, string> = {}): void {
  const values = { ...DEFAULT_INPUTS, ...overrides }
  getInput.mockImplementation((name, options) => {
    const raw = values[name] ?? ''
    if (options?.required && !raw) {
      throw new Error(`Input required and not supplied: ${name}`)
    }
    return raw.trim()
  })
}

function mockRun(tap: string | undefined, exitCode = 0): void {
  tapContentToWrite = tap
  execResult = { stdout: '', stderr: '', exitCode }
}

function outputValues(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const call of setOutput.mock.calls) {
    result[call[0]] = call[1]
  }
  return result
}

const ALL_PASSING_TAP = `1..2\nok 1 - test one\nok 2 - test two\n`
const ONE_FAILING_TAP = `1..2\nok 1 - test one\nnot ok 2 - test two\n`

beforeEach(() => {
  setInputs()
  which.mockResolvedValue('/usr/bin/nf-test')
  tapContentToWrite = undefined
  execResult = { stdout: '', stderr: '', exitCode: 0 }
})

describe('an all-passing run', () => {
  it('sets outputs and does not throw', async () => {
    mockRun(ALL_PASSING_TAP, 0)
    await expect(run()).resolves.toBeUndefined()
    expect(outputValues().total).toBe('2')
    expect(outputValues().passed).toBe('2')
    expect(outputValues().failed).toBe('0')
    expect(outputValues().todo).toBe('0')
    expect(outputValues().skip).toBe('0')
    expect(outputValues().skipped).toBe('0')
    expect(outputValues()['tap-path']).toMatch(/test\.tap$/)
    expect(outputValues()['exit-code']).toBe('0')
    expect(outputValues()['bailed-out']).toBe('false')
  })
})

describe('a run with one failure', () => {
  it('fails the action with the captured output included, even though it still sets outputs', async () => {
    tapContentToWrite = ONE_FAILING_TAP
    execResult = {
      stdout: 'nextflow log line',
      stderr: 'error report: /work/1a2b3c/.command.err',
      exitCode: 0
    }
    let error: unknown
    try {
      await run()
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toMatch(/1 of 2 test\(s\) failed/)
    expect(message).toMatch(/nextflow log line/)
    expect(message).toMatch(/error report: \/work\/1a2b3c\/\.command\.err/)
    expect(outputValues().failed).toBe('1')
  })

  it('fails when nf-test itself exits non-zero, alongside the failed tests', async () => {
    mockRun(ONE_FAILING_TAP, 1)
    await expect(run()).rejects.toThrow(/nf-test exited with code 1/)
  })
})

describe('a run that reports zero tests', () => {
  it('fails even when nf-test exits 0 and writes no TAP output at all', async () => {
    mockRun(undefined, 0)
    execResult = { stdout: '', stderr: '', exitCode: 0 }
    await expect(run()).rejects.toThrow(/nf-test reported zero tests/)
    expect(setOutput).not.toHaveBeenCalled()
  })

  it('fails even when nf-test exits 0 and the TAP file has a plan line but no results', async () => {
    mockRun('1..3\n', 0)
    await expect(run()).rejects.toThrow(/nf-test reported zero tests/)
    expect(setOutput).not.toHaveBeenCalled()
  })

  it('includes the captured output when it fails with a non-zero exit and no parseable TAP', async () => {
    mockRun(undefined, 1)
    execResult = {
      stdout: 'boom: crashed before writing TAP',
      stderr: 'stack trace',
      exitCode: 1
    }
    let error: unknown
    try {
      await run()
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toMatch(/nf-test reported zero tests/)
    expect(message).toMatch(/boom: crashed before writing TAP/)
    expect(message).toMatch(/stack trace/)
    expect(setOutput).not.toHaveBeenCalled()
  })
})

describe('a Bail out!', () => {
  it('fails the action with the bail-out reason and sets bailed-out', async () => {
    mockRun('1..3\nok 1 - test one\nBail out! Nextflow crashed\n', 1)
    await expect(run()).rejects.toThrow(/nf-test bailed out: Nextflow crashed/)
    expect(outputValues()['bailed-out']).toBe('true')
  })
})

describe('a plan-count mismatch', () => {
  it('fails when fewer results were reported than the plan announced', async () => {
    mockRun('1..5\nok 1 - test one\nok 2 - test two\n', 0)
    await expect(run()).rejects.toThrow(
      /plan announced 5 test\(s\) but only 2 were reported/
    )
  })
})

describe('input validation', () => {
  it('fails on a whitespace-only profile, which passes the required check but resolves empty', async () => {
    setInputs({ profile: '   ' })
    await expect(run()).rejects.toThrow(/profile must not be empty/)
  })

  it('fails when shard is greater than total-shards', async () => {
    setInputs({ shard: '4', 'total-shards': '3' })
    await expect(run()).rejects.toThrow(/must not be greater than total-shards/)
  })
})

describe('nf-test missing from PATH', () => {
  it('gives an install-first message and never runs nf-test', async () => {
    which.mockResolvedValue('')
    await expect(run()).rejects.toThrow(/install it before this action runs/)
    expect(getExecOutput).not.toHaveBeenCalled()
  })
})

describe('argv and logging', () => {
  it('builds the exec call from the action inputs', async () => {
    mockRun(ALL_PASSING_TAP, 0)
    await run()
    const [command, args, options] = getExecOutput.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>
    ]
    expect(command).toBe('nf-test')
    expect(args.slice(0, 6)).toEqual([
      'test',
      '--profile=+docker',
      '--ci',
      '--changed-since',
      'HEAD^',
      '--verbose'
    ])
    expect(args).toContain('--shard')
    expect(args[args.indexOf('--shard') + 1]).toBe('1/3')
    expect(options).toEqual(
      expect.objectContaining({ ignoreReturnCode: true, silent: true })
    )
  })

  it('passes a tags value with shell metacharacters and a newline as one unmodified argv element, and logs it without a raw newline', async () => {
    const dangerousTag = 'foo; rm -rf / #\ninjected-directive'
    setInputs({ tags: dangerousTag })
    mockRun(ALL_PASSING_TAP, 0)

    await run()

    const [, args] = getExecOutput.mock.calls[0] as [string, string[]]
    expect(args.filter((arg) => arg === dangerousTag)).toHaveLength(1)

    const runningLine = info.mock.calls
      .map((call) => call[0] as string)
      .find((message) => message.includes('Running:'))
    expect(runningLine).toBeDefined()
    expect(runningLine).not.toContain('\n')
  })
})
