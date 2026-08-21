import * as core from '@actions/core'

/**
 * Writes the job summary and never throws. core.summary.write() throws when
 * GITHUB_STEP_SUMMARY is unset or unwritable, for example a local run or
 * `act`. Outputs are already published by the time this runs, so a missing
 * summary is a warning, not a failed action.
 */
export async function writeSummaryBestEffort(): Promise<void> {
  try {
    await core.summary.write()
  } catch (error) {
    core.warning(
      `Could not write the job summary: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
