import { describe, expect, it, jest } from '@jest/globals'

const runAction = jest.fn()
const run = jest.fn<() => Promise<void>>()

jest.unstable_mockModule('../../src/lib/run-action.js', () => ({ runAction }))
jest.unstable_mockModule('../../src/actions/branch/run.js', () => ({ run }))

describe('index entry point', () => {
  it('runs the action through runAction', async () => {
    await import('../../src/actions/branch/index.js')
    expect(runAction).toHaveBeenCalledWith(run)
  })
})
