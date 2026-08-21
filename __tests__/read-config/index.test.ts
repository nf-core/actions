import { describe, expect, it, jest } from '@jest/globals'

const setFailed = jest.fn()
const run = jest.fn<() => Promise<void>>(() =>
  Promise.reject(new Error('boom'))
)

jest.unstable_mockModule('@actions/core', () => ({ setFailed }))
jest.unstable_mockModule('../../src/actions/read-config/run.js', () => ({
  run
}))

describe('index entry point', () => {
  it('turns a rejected run() into core.setFailed instead of an unhandled rejection', async () => {
    await import('../../src/actions/read-config/index.js')
    // Flush the microtask queue so the run().catch() handler has a chance to run.
    await new Promise((resolve) => setImmediate(resolve))
    expect(setFailed).toHaveBeenCalledWith('boom')
  })
})
