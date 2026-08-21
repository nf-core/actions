// Pure, testable pieces of nf-test: turning inputs into an nf-test argument
// array, and validating them. No I/O here.

import { assertPositiveInteger } from '../../lib/positive-integer.js'

/** Fallback for the 'verbose' input. action.yml's declared default must match this. */
export const DEFAULT_VERBOSE = true

export interface NfTestInputs {
  profile: string
  shard: number
  totalShards: number
  tags: string
  changedSince: string
  verbose: boolean
  extraArgs: string[]
}

/** Throws unless `profile` is non-empty. */
export function assertProfile(profile: string): void {
  if (profile.trim() === '') {
    throw new Error('profile must not be empty.')
  }
}

/** Parses a shard number input. Throws unless it is a positive integer. */
export function parseShardNumber(raw: string, label: string): number {
  const value = Number(raw)
  assertPositiveInteger(value, label)
  return value
}

/** Throws if `shard` is greater than `totalShards`. */
export function assertShardWithinTotal(
  shard: number,
  totalShards: number
): void {
  if (shard > totalShards) {
    throw new Error(
      `shard (${String(shard)}) must not be greater than total-shards (${String(totalShards)}).`
    )
  }
}

/** Parses the 'verbose' input. Empty means the default. Throws on anything else. */
export function parseVerbose(raw: string): boolean {
  if (raw === '') return DEFAULT_VERBOSE
  if (raw.toLowerCase() === 'true') return true
  if (raw.toLowerCase() === 'false') return false
  throw new Error(`verbose must be 'true' or 'false'. Got: ${raw}`)
}

// Flags this action already sets. extra-args must not repeat any of these:
// with last-wins parsing, a repeat would override the action's own value
// (for example, redirecting --tap away from the path this action reads).
const RESERVED_FLAGS = [
  '--tap',
  '--shard',
  '--profile',
  '--tag',
  '--changed-since',
  '--verbose',
  '--ci'
]

/** Throws if `args` sets a flag this action already owns, in either '--flag=value' or '--flag value' form. */
function assertNoReservedFlags(args: string[]): void {
  for (const arg of args) {
    const flag = arg.split('=')[0] ?? arg
    if (RESERVED_FLAGS.includes(flag)) {
      throw new Error(
        `extra-args must not set '${flag}': this action already sets it. Got: ${arg}`
      )
    }
  }
}

/**
 * Parses 'extra-args'. Must be a JSON array of strings, so each element
 * reaches nf-test as its own argv element. A plain string would need
 * splitting on spaces by something downstream, reopening the shell-injection
 * risk this action avoids everywhere else.
 */
export function parseExtraArgs(raw: string): string[] {
  if (raw.trim() === '') return []

  const fail = (): never => {
    throw new Error(
      `extra-args must be a JSON array of strings, for example '["--follow-dependencies"]'. Got: ${raw}`
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
  assertNoReservedFlags(parsed)
  return parsed
}

/**
 * Builds the argv for `nf-test test`. Every value is its own array element,
 * so a value with shell metacharacters (for example a tag of 'foo; rm -rf /')
 * is passed through as literal text. There is no shell string to inject into.
 */
export function buildArgs(inputs: NfTestInputs, tapPath: string): string[] {
  const args = ['test', `--profile=+${inputs.profile}`]
  if (inputs.tags) args.push('--tag', inputs.tags)
  args.push('--ci')
  // An empty changedSince deliberately means "consider every test": omit
  // the flag instead of passing it an empty value.
  if (inputs.changedSince) args.push('--changed-since', inputs.changedSince)
  if (inputs.verbose) args.push('--verbose')
  args.push(`--tap=${tapPath}`)
  args.push('--shard', `${String(inputs.shard)}/${String(inputs.totalShards)}`)
  args.push(...inputs.extraArgs)
  return args
}
