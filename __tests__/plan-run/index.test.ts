import { describe, expect, it, jest } from '@jest/globals'

const runAction = jest.fn()
const run = jest.fn<() => Promise<void>>()

jest.unstable_mockModule('../../src/lib/run-action.js', () => ({ runAction }))
jest.unstable_mockModule('../../src/actions/plan-run/run.js', () => ({ run }))

describe('index entry point', () => {
  it('runs the action through runAction', async () => {
    await import('../../src/actions/plan-run/index.js')
    expect(runAction).toHaveBeenCalledWith(run)
  })
})
