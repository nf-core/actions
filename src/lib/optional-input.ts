// core.getInput() cannot tell "input absent" from "input supplied empty": it
// reads the same environment variable either way, and returns '' for both.
// Reading that variable directly restores the distinction.

/**
 * Reads an input, falling back to `fallback` only when the input was not
 * supplied at all. An explicit empty value is returned as `''`, not the
 * fallback: a caller that means "empty" gets "empty".
 */
export function getInputOrDefault(name: string, fallback: string): string {
  const envName = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`
  const raw = process.env[envName]
  return raw === undefined ? fallback : raw.trim()
}
