// Pure decision logic for plan-run: which nf-test profiles a run uses, and
// what changed-since value it passes to nf-test. No I/O here; run.ts owns
// inputs and outputs.

export interface PlanInputs {
  profiles: string[]
  variant: string
  eventName: string
  baseRef: string
}

export interface Plan {
  testProfiles: string[]
  changedSince: string
  /** Human-readable reason for the chosen profile set, for the job summary. */
  reason: string
}

/**
 * Parses the 'profiles' input: read-config's 'profiles' output, a JSON array
 * of strings. Rejects an empty list with a clear error naming the setting,
 * rather than letting a reduced run pick a null entry from `profiles[0]`.
 */
export function parseProfiles(raw: string): string[] {
  const fail = (): never => {
    throw new Error(
      `profiles must be a JSON array of strings, for example '["docker","singularity"]'. Got: ${raw}`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail()
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === 'string')
  ) {
    return fail()
  }
  if (parsed.length === 0) {
    throw new Error('profiles must not be an empty list.')
  }
  return parsed
}

/** A pull request whose base is a release branch: 'master' or 'main'. */
function isReleasePullRequest(eventName: string, baseRef: string): boolean {
  return (
    eventName === 'pull_request' && (baseRef === 'master' || baseRef === 'main')
  )
}

/** The single profile a reduced run uses: 'docker' when configured, otherwise the first entry. Order-independent. */
function reduceProfiles(profiles: string[]): string[] {
  return profiles.includes('docker') ? ['docker'] : profiles.slice(0, 1)
}

function fullRunTrigger(eventName: string, baseRef: string): string {
  if (eventName === 'release') return "the event is 'release'"
  if (eventName === 'workflow_dispatch')
    return "the event is 'workflow_dispatch'"
  return `the pull request targets the release branch '${baseRef}'`
}

function reducedRunTrigger(inputs: PlanInputs): string {
  if (inputs.variant)
    return `variant '${inputs.variant}' always runs a single profile`
  if (inputs.eventName === 'pull_request') {
    return `the pull request targets '${inputs.baseRef}', not a release branch`
  }
  return `the event is '${inputs.eventName}'`
}

/**
 * Decides the profile set and changed-since value for a run.
 *
 * The full profile set runs for the default variant, on a release pull
 * request (base 'master' or 'main'), or on a 'release' or 'workflow_dispatch'
 * event. Every other case (an ordinary pull request against 'dev', or any
 * variant such as 'arm' or 'gpu') gets a single profile: 'docker' when
 * configured, otherwise the first configured profile.
 */
export function planRun(inputs: PlanInputs): Plan {
  if (inputs.profiles.length === 0) {
    throw new Error('ci.profiles must not be an empty list.')
  }

  const fullRun =
    inputs.variant === '' &&
    (isReleasePullRequest(inputs.eventName, inputs.baseRef) ||
      inputs.eventName === 'release' ||
      inputs.eventName === 'workflow_dispatch')

  if (fullRun) {
    return {
      testProfiles: inputs.profiles,
      changedSince: changedSinceFor(inputs.eventName),
      reason: `Full profile set: ${fullRunTrigger(inputs.eventName, inputs.baseRef)}.`
    }
  }

  const testProfiles = reduceProfiles(inputs.profiles)
  return {
    testProfiles,
    changedSince: changedSinceFor(inputs.eventName),
    reason: `Reduced to one profile ('${testProfiles.join(', ')}'): ${reducedRunTrigger(inputs)}.`
  }
}

/** '' (test everything) for 'release' and 'workflow_dispatch', 'HEAD^' otherwise. */
function changedSinceFor(eventName: string): string {
  return eventName === 'release' || eventName === 'workflow_dispatch'
    ? ''
    : 'HEAD^'
}
