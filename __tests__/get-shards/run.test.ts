import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const getInput =
  jest.fn<(name: string, options?: { required?: boolean }) => string>()
const info = jest.fn()
const warning = jest.fn()
const setOutput = jest.fn<(name: string, value: string) => void>()
const write = jest.fn(() => Promise.resolve())

// The real Summary API returns `this` from addHeading/addRaw so calls chain,
// and write() lives on that same instance.
const summary: Record<string, jest.Mock> = {}
summary.addHeading = jest.fn(() => summary)
summary.addRaw = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({
  getInput,
  info,
  warning,
  setOutput,
  summary
}))

const getExecOutput =
  jest.fn<
    (
      commandLine: string,
      args?: string[],
      options?: Record<string, unknown>
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  >()

jest.unstable_mockModule('@actions/exec', () => ({ getExecOutput }))

// which()'s `check` argument defaults to false: it resolves to a path (or
// any non-empty string here) when the tool is on PATH, and '' when it is not.
const which = jest.fn<() => Promise<string>>(() =>
  Promise.resolve('/usr/bin/nf-test')
)

jest.unstable_mockModule('@actions/io', () => ({ which }))

const { run } = await import('../../src/actions/get-shards/run.js')

const DEFAULT_INPUTS: Record<string, string> = {
  'max-shards': '10',
  profile: '',
  tags: '',
  'changed-since': 'HEAD^'
}

function setInputs(overrides: Record<string, string> = {}): void {
  const values = { ...DEFAULT_INPUTS, ...overrides }
  getInput.mockImplementation((name, options) => {
    const value = values[name] ?? ''
    if (options?.required && !value) {
      throw new Error(`Input required and not supplied: ${name}`)
    }
    return value
  })
}

function mockDryRun(stdout: string, exitCode = 0, stderr = ''): void {
  getExecOutput.mockResolvedValue({ stdout, stderr, exitCode })
}

function outputValues(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const call of setOutput.mock.calls) {
    result[call[0]] = call[1]
  }
  return result
}

beforeEach(() => {
  setInputs()
  which.mockResolvedValue('/usr/bin/nf-test')
})

describe('shard counting', () => {
  it('uses the test count as the shard count when it is below the cap', async () => {
    mockDryRun('Executed 5 tests in 2ms')
    await run()
    expect(outputValues().shards).toBe('[1,2,3,4,5]')
    expect(outputValues()['total-shards']).toBe('5')
    expect(outputValues()['has-tests']).toBe('true')
  })

  it('caps the shard count when the test count is above max-shards', async () => {
    setInputs({ 'max-shards': '10' })
    mockDryRun('Executed 50 tests in 9ms')
    await run()
    expect(outputValues().shards).toBe('[1,2,3,4,5,6,7,8,9,10]')
    expect(outputValues()['total-shards']).toBe('10')
    expect(outputValues()['has-tests']).toBe('true')
  })

  it('uses exactly max-shards when the test count equals the cap', async () => {
    setInputs({ 'max-shards': '7' })
    mockDryRun('Executed 7 tests in 5ms')
    await run()
    expect(outputValues().shards).toBe('[1,2,3,4,5,6,7]')
    expect(outputValues()['total-shards']).toBe('7')
  })

  it('reports no tests as an empty array, zero shards, and has-tests false, without failing', async () => {
    mockDryRun('No tests to execute.')
    await expect(run()).resolves.toBeUndefined()
    expect(outputValues().shards).toBe('[]')
    expect(outputValues()['total-shards']).toBe('0')
    expect(outputValues()['has-tests']).toBe('false')
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('No related tests found')
    )
  })
})

describe('failure modes', () => {
  it('fails on a non-zero exit code, including the captured output', async () => {
    mockDryRun('boom: something went wrong', 1, 'stderr detail')
    await expect(run()).rejects.toThrow(/boom: something went wrong/)
    await expect(run()).rejects.toThrow(/stderr detail/)
    expect(setOutput).not.toHaveBeenCalled()
  })

  it('gives an "install nf-test first" message when nf-test is missing from PATH', async () => {
    which.mockResolvedValue('')
    await expect(run()).rejects.toThrow(/install it before this action runs/)
    expect(getExecOutput).not.toHaveBeenCalled()
  })

  it('propagates an unrelated exec error unchanged', async () => {
    getExecOutput.mockRejectedValue(new Error('spawn EACCES'))
    await expect(run()).rejects.toThrow('spawn EACCES')
  })
})

describe('wiring', () => {
  it('builds the exec call from the action inputs', async () => {
    mockDryRun('Executed 1 tests in 1ms')
    await run()
    expect(getExecOutput).toHaveBeenCalledWith(
      'nf-test',
      [
        'test',
        '--profile',
        '+docker',
        '--dry-run',
        '--ci',
        '--changed-since',
        'HEAD^'
      ],
      expect.objectContaining({ ignoreReturnCode: true, silent: true })
    )
  })

  it('fails when max-shards is not a positive integer', async () => {
    setInputs({ 'max-shards': 'many' })
    await expect(run()).rejects.toThrow(/positive integer/)
    expect(setOutput).not.toHaveBeenCalled()
  })
})

describe('tags injection', () => {
  it('passes a tags value with shell metacharacters to getExecOutput as one unmodified argv element', async () => {
    const dangerousTag = 'foo; touch /tmp/pwned; $(whoami)'
    setInputs({ tags: dangerousTag })
    mockDryRun('Executed 1 tests in 1ms')

    await run()

    const [, args] = getExecOutput.mock.calls[0] as [string, string[]]
    expect(args).toContain(dangerousTag)
    // Exactly one element carries the value: run() does not split, expand,
    // or otherwise re-mangle it on the way to the process.
    expect(args.filter((arg) => arg === dangerousTag)).toHaveLength(1)
  })
})
