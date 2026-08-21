import { which } from '@actions/io'

/**
 * Throws a clear "install it first" message unless `tool` is on PATH.
 * which()'s `check` argument defaults to false: it returns '' instead of
 * throwing when the tool is missing, so the empty-string case is checked
 * explicitly here.
 */
export async function requireOnPath(
  tool: string,
  installHint: string
): Promise<void> {
  if ((await which(tool)) === '') {
    throw new Error(`${tool} is not on PATH. ${installHint}`)
  }
}
