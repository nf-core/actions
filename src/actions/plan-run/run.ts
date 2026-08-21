import * as core from '@actions/core'
import { encodeOutput } from '../../lib/encode-output.js'
import { escapeHtml } from '../../lib/escape-html.js'
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
  // testProfiles and reason both derive from 'ci.profiles' in the
  // pipeline's .nf-core.yml, which a contributor controls on a pull
  // request: addRaw() writes raw HTML, unescaped, so both are escaped here.
  core.summary
    .addHeading('plan-run: run plan', 3)
    .addRaw(
      `Profiles: ${escapeHtml(plan.testProfiles.join(', '))}. Changed-since: ${plan.changedSince || '(everything)'}. ${escapeHtml(plan.reason)}`,
      true
    )
  return writeSummaryBestEffort()
}

/** Decides the test profiles and changed-since value for this run, from the workflow's inputs. */
export async function run(): Promise<void> {
  const inputs = readInputs()
  const plan = planRun(inputs)

  // JSON-encodes profiles and reason before logging: the same reasoning as
  // run-nf-test.ts, it renders a newline in an untrusted value (a profile
  // name) as \n, so it can't inject a workflow command into the log.
  core.info(
    `Plan: profiles=${JSON.stringify(plan.testProfiles)} reason=${JSON.stringify(plan.reason)}`
  )
  core.setOutput('test-profiles', encodeOutput(plan.testProfiles))
  core.setOutput('changed-since', plan.changedSince)

  await writeSummary(plan)
}
