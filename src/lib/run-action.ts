import * as core from '@actions/core'

/**
 * Runs an action's entry point. Any throw inside `run`, including a rejected
 * promise, becomes a failed action instead of an unhandled rejection.
 */
export function runAction(run: () => Promise<void>): void {
  run().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error))
  })
}
