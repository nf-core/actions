// Pure, testable pieces of get-shards: turning inputs into an nf-test
// argument array, and validating max-shards. No I/O here.

import { assertPositiveInteger } from '../../lib/positive-integer.js'

/** Fallback for the 'profile' input. action.yml's declared default must match this. */
export const DEFAULT_PROFILE = 'docker'

/** Fallback for the 'changed-since' input. action.yml's declared default must match this. */
export const DEFAULT_CHANGED_SINCE = 'HEAD^'

export interface DryRunInputs {
  profile: string
  tags: string
  changedSince: string
}

/**
 * Builds the argv for nf-test's dry run. Every value is its own array
 * element, so a value with shell metacharacters (for example a tag of
 * 'foo; rm -rf /') is passed through as literal text. There is no shell
 * string to inject into.
 */
export function buildArgs(inputs: DryRunInputs): string[] {
  const args = ['test', '--profile', `+${inputs.profile}`]
  if (inputs.tags) args.push('--tag', inputs.tags)
  args.push('--dry-run', '--ci')
  // An empty changedSince deliberately means "consider every test": omit
  // the flag instead of passing it an empty value.
  if (inputs.changedSince) args.push('--changed-since', inputs.changedSince)
  return args
}

/** Parses the 'max-shards' input. Throws unless it is a positive integer. */
export function parseMaxShards(raw: string): number {
  const value = Number(raw)
  assertPositiveInteger(value, 'max-shards')
  return value
}
