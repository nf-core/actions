import * as core from '@actions/core'
import { type Document, isScalar } from 'yaml'
import { assertPositiveInteger } from '../../lib/positive-integer.js'
import { type SettingDef, type ValueKind, KNOWN_CI_KEYS } from './registry.js'

export type Source = 'input' | 'file' | 'default'
export type SettingValue = string | string[] | number

export interface Resolved {
  value: SettingValue
  source: Source
}

function kindLabel(kind: ValueKind): string {
  if (kind === 'string') return 'a string'
  if (kind === 'string-list') return 'a list of strings'
  return 'a number'
}

function matchesKind(kind: ValueKind, value: unknown): boolean {
  if (kind === 'string') return typeof value === 'string'
  if (kind === 'string-list') {
    return (
      Array.isArray(value) && value.every((item) => typeof item === 'string')
    )
  }
  return typeof value === 'number'
}

/**
 * A YAML scalar like `2.10` or `3.0` parses as a number, not the string the
 * maintainer wrote: `String(2.1)` is `"2.1"`, silently dropping the trailing
 * zero. Recover the maintainer's own text from the parsed document instead.
 * Falls back to `String(value)` when there is no source text, for example a
 * value that did not come from a parsed file.
 */
function scalarSourceAt(
  doc: Document | undefined,
  path: string
): string | undefined {
  const node = doc?.getIn(path.split('.'), true)
  return isScalar(node) && typeof node.source === 'string'
    ? node.source
    : undefined
}

/**
 * For a 'string' setting, accept a YAML number or boolean and convert it to
 * text, so an unquoted version in .nf-core.yml still resolves instead of
 * hard-failing. Anything non-scalar (a list, a mapping) is left alone and
 * still fails the kind check below.
 */
function coerceStringScalar(
  kind: ValueKind,
  value: unknown,
  source: string | undefined
): unknown {
  if (
    kind === 'string' &&
    (typeof value === 'number' || typeof value === 'boolean')
  ) {
    return source ?? String(value)
  }
  return value
}

/** Reads a dot-separated path out of a parsed YAML document. Undefined if any segment is missing. */
export function getAtPath(doc: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (
      node !== null &&
      typeof node === 'object' &&
      !Array.isArray(node) &&
      key in node
    ) {
      return (node as Record<string, unknown>)[key]
    }
    return undefined
  }, doc)
}

// Action inputs are always strings, so a list or number input carries the
// same JSON an output would carry. This keeps one format for both directions.
function parseInput(setting: SettingDef, raw: string): SettingValue {
  if (setting.kind === 'string') return raw

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `Input '${setting.output}' must be valid JSON (${kindLabel(setting.kind)}). Got: ${raw}`
    )
  }
  if (!matchesKind(setting.kind, parsed)) {
    throw new Error(
      `Input '${setting.output}' must be ${kindLabel(setting.kind)}. Got: ${raw}`
    )
  }
  // Only max-shards is a 'number' setting today, and a shard count of zero or
  // a fraction cannot build a matrix. If a future number setting legitimately
  // allows zero or a fraction, give it a per-setting constraint instead of
  // loosening this one.
  if (setting.kind === 'number') {
    assertPositiveInteger(parsed as number, `Input '${setting.output}'`)
  }
  return parsed as SettingValue
}

/**
 * Resolves one setting: input, then .nf-core.yml, then the built-in default.
 * Throws on a malformed input or a wrong-typed config value. Never coerces,
 * except for a string setting given an unquoted YAML number or boolean.
 */
export function resolveSetting(
  setting: SettingDef,
  config: unknown,
  doc?: Document
): Resolved {
  if (setting.hasInput) {
    const raw = core.getInput(setting.output)
    if (raw.trim() !== '') {
      const value = parseInput(setting, raw)
      core.info(
        `${setting.output}: using the '${setting.output}' input (wins over .nf-core.yml and the default)`
      )
      return { value, source: 'input' }
    }
  }

  const rawFileValue = getAtPath(config, setting.configPath)
  if (rawFileValue !== undefined) {
    const source = scalarSourceAt(doc, setting.configPath)
    const fileValue = coerceStringScalar(setting.kind, rawFileValue, source)
    if (fileValue !== rawFileValue) {
      core.info(
        `${setting.configPath}: read as the ${typeof rawFileValue} ${JSON.stringify(rawFileValue)}, not a string. Quote it in .nf-core.yml. Using '${String(fileValue)}'.`
      )
    }

    if (!matchesKind(setting.kind, fileValue)) {
      throw new Error(
        `.nf-core.yml: '${setting.configPath}' must be ${kindLabel(setting.kind)}. Got: ${JSON.stringify(rawFileValue)}`
      )
    }
    if (setting.kind === 'number') {
      assertPositiveInteger(
        fileValue as number,
        `.nf-core.yml: '${setting.configPath}'`
      )
    }
    core.info(
      `${setting.output}: using '${setting.configPath}' from .nf-core.yml (wins over the default)`
    )
    return { value: fileValue as SettingValue, source: 'file' }
  }

  if (setting.hasInput) {
    core.warning(
      `${setting.output} is not set. Using the default ${JSON.stringify(setting.default)}. ` +
        `Set it with the '${setting.output}' input or '${setting.configPath}' in .nf-core.yml.`
    )
  } else {
    core.warning(
      `'${setting.configPath}' is not set in .nf-core.yml. ${setting.output} defaults to an empty string.`
    )
  }
  return { value: setting.default, source: 'default' }
}

/**
 * Validates the optional 'ci:' block and warns about typo-prone keys it does
 * not recognize. Throws if 'ci:' is present but is not a mapping, so a typo
 * like `ci: oops` fails loudly instead of silently defaulting every setting.
 * `ci:` with no value parses as null and is treated the same as absent.
 */
export function warnUnknownCiKeys(config: unknown): void {
  const ci = getAtPath(config, 'ci')
  if (ci === undefined || ci === null) return
  if (typeof ci !== 'object' || Array.isArray(ci)) {
    throw new Error(
      `.nf-core.yml: 'ci' must be a mapping. Got: ${JSON.stringify(ci)}`
    )
  }

  const unknown = Object.keys(ci as Record<string, unknown>).filter(
    (key) => !KNOWN_CI_KEYS.includes(key)
  )
  if (unknown.length > 0) {
    core.warning(
      `Unknown key(s) under 'ci:' in .nf-core.yml, ignored: ${unknown.join(', ')}`
    )
  }
}
