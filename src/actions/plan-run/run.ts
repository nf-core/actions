import * as core from '@actions/core'
import { encodeOutput } from '../../lib/encode-output.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import { parseProfiles, planRun, type PlanInputs } from './plan.js'

function readInputs(): PlanInputs {
  return {
    profiles: parseProfiles(core.getInput('profiles', { required: true })),
    variant: core.getInput('variant'),
    eventName: core.getInput('event-name', { required: true }),
    baseRef: core.getInput('base-ref')
  }
}

function writeSummary(plan: {
  testProfiles: string[]
  changedSince: string
  reason: string
}): Promise<void> {
  core.summary
    .addHeading('plan-run: run plan', 3)
    .addRaw(
      `Profiles: ${plan.testProfiles.join(', ')}. Changed-since: ${plan.changedSince || '(everything)'}. ${plan.reason}`,
      true
    )
  return writeSummaryBestEffort()
}

/** Decides the test profiles and changed-since value for this run, from the workflow's inputs. */
export async function run(): Promise<void> {
  const inputs = readInputs()
  const plan = planRun(inputs)

  core.info(plan.reason)
  core.setOutput('test-profiles', encodeOutput(plan.testProfiles))
  core.setOutput('changed-since', plan.changedSince)

  await writeSummary(plan)
}
