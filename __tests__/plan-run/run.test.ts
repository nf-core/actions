import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const getInput =
  jest.fn<(name: string, options?: { required?: boolean }) => string>()
const info = jest.fn()
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
  setOutput,
  summary
}))

const { run } = await import('../../src/actions/plan-run/run.js')

const DEFAULT_INPUTS: Record<string, string> = {
  profiles: '["conda","docker","singularity"]',
  variant: '',
  'event-name': 'push',
  'base-ref': ''
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

function outputValues(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const call of setOutput.mock.calls) {
    result[call[0]] = call[1]
  }
  return result
}

beforeEach(() => {
  setInputs()
})

describe('wiring', () => {
  it('reads inputs, decides the plan, and publishes both outputs', async () => {
    setInputs({
      'event-name': 'pull_request',
      'base-ref': 'master'
    })
    await run()
    expect(outputValues()['test-profiles']).toBe(
      '["conda","docker","singularity"]'
    )
    expect(outputValues()['changed-since']).toBe('HEAD^')
  })

  it('reduces to one profile for an ordinary pull request', async () => {
    setInputs({ 'event-name': 'pull_request', 'base-ref': 'dev' })
    await run()
    expect(outputValues()['test-profiles']).toBe('["docker"]')
    expect(outputValues()['changed-since']).toBe('HEAD^')
  })

  it('fails with a clear message on an empty profiles list, and sets no output', async () => {
    setInputs({ profiles: '[]' })
    await expect(run()).rejects.toThrow(/profiles must not be an empty list/)
    expect(setOutput).not.toHaveBeenCalled()
  })

  it('writes a job summary', async () => {
    await run()
    expect(summary.addRaw).toHaveBeenCalled()
    expect(write).toHaveBeenCalled()
  })

  it('renders an empty changed-since in the summary as "(everything)"', async () => {
    setInputs({ 'event-name': 'release' })
    await run()
    const [text] = summary.addRaw!.mock.calls[0] as [string]
    expect(text).toContain('Changed-since: (everything)')
  })
})
