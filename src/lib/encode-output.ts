// One encoding for every action output. The format is a contract with
// workflows that call fromJSON() on the output, so it stays explicit here
// instead of behind core.setOutput's own stringify.

export type OutputValue = string | number | boolean | string[] | number[]

/**
 * Encodes a value for core.setOutput(). A string passes through unchanged.
 * Anything else is JSON, so a caller uses fromJSON() to get back a number,
 * a boolean, or an array.
 */
export function encodeOutput(value: OutputValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
