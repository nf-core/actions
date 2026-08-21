import * as core from '@actions/core'
import { run } from './run.js'

// Any throw inside run(), including a rejected promise, becomes a failed
// action instead of an unhandled rejection.
run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error))
})
