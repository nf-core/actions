import { readFileSync } from 'node:fs'
import * as core from '@actions/core'
import { escapeHtml } from '../../lib/escape-html.js'
import { writeSummaryBestEffort } from '../../lib/write-summary.js'
import { newEntries, parseFileList } from './diff.js'

interface Inputs {
  beforePath: string
  afterPath: string
}

function readInputs(): Inputs {
  return {
    beforePath: core.getInput('before-path', { required: true }),
    afterPath: core.getInput('after-path', { required: true })
  }
}

/** Container filenames are attacker-influenceable (pipeline code sets its own container tags), so escape before this reaches the summary as HTML. */
function writeSummary(cachedCount: number, added: string[]): Promise<void> {
  core.summary.addHeading('verify-offline-run: container cache', 3)
  if (added.length === 0) {
    core.summary.addRaw(
      `All ${String(cachedCount)} container image(s) the run needed were already cached by the download step. The pipeline ran fully offline.`,
      true
    )
  } else {
    core.summary
      .addRaw(
        `${String(added.length)} container image(s) were pulled while the pipeline ran, not present after the download step:`,
        true
      )
      .addList(added.map(escapeHtml))
  }
  return writeSummaryBestEffort()
}

/**
 * Compares the container cache directory's contents before and after the
 * downloaded pipeline ran. An image present afterwards but not before was
 * fetched at runtime: 'nf-core pipelines download' is meant to produce a
 * cache complete enough to run offline, so this fails the run instead of
 * only warning, the same as the shell version it replaces did.
 *
 * An empty 'after' listing also fails: no pipeline run legitimately
 * downloads zero containers, so an empty listing means the listing step
 * itself did not run correctly, and an empty 'before' would then also make
 * every genuinely new image look like a pass by comparison.
 */
export async function run(): Promise<void> {
  const inputs = readInputs()
  const before = parseFileList(readFileSync(inputs.beforePath, 'utf8'))
  const after = parseFileList(readFileSync(inputs.afterPath, 'utf8'))

  if (after.length === 0) {
    const message =
      "The 'after' container cache listing is empty, so this check could not verify anything: no pipeline run legitimately downloads zero containers. Confirm the cache directory and its snapshot step ran correctly."
    core.summary
      .addHeading('verify-offline-run: container cache', 3)
      .addRaw(message, true)
    await writeSummaryBestEffort()
    throw new Error(message)
  }

  const added = newEntries(before, after)

  await writeSummary(after.length, added)

  if (added.length > 0) {
    // JSON-encoded: these names come from the pipeline's own container
    // directives, so a value containing a newline can't inject a workflow
    // command into the log (same reasoning as validate-patch's audit log).
    throw new Error(
      `${String(added.length)} container image(s) were downloaded while running the pipeline, so the offline download was incomplete: ${JSON.stringify(added)}`
    )
  }

  core.info(
    `verify-offline-run: ${String(after.length)} container image(s) cached, none pulled at runtime.`
  )
}
