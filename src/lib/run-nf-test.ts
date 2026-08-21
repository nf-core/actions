// Shared between get-shards and nf-test: both run the nf-test binary the
// same way. This is the security-critical part of both actions (argument
// logging, command echoing), so it lives in one place.

import * as core from '@actions/core'
import { getExecOutput } from '@actions/exec'
import { requireOnPath } from './require-on-path.js'

/** Fallback for the 'changed-since' input. Same value in get-shards and nf-test. */
export const DEFAULT_CHANGED_SINCE = 'HEAD^'

const NFTEST_INSTALL_HINT =
  'The calling workflow must install it before this action runs, for example with nf-core/setup-nf-test.'

export interface NfTestExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Requires nf-test on PATH, then runs it with `args` and returns its
 * captured output.
 *
 * JSON-encodes the args before logging: it renders a newline in an
 * untrusted value (a tag, a changed-since ref) as the two characters \n, so
 * the value can't inject a workflow command into the log.
 *
 * silent: true stops @actions/exec echoing its own unencoded "[command]
 * nf-test <args>" line, which would otherwise reopen the same injection the
 * JSON-encoded log line closes. getExecOutput still captures stdout and
 * stderr regardless of this option.
 */
export async function runNfTest(args: string[]): Promise<NfTestExecResult> {
  await requireOnPath('nf-test', NFTEST_INSTALL_HINT)

  core.info(`Running: nf-test ${JSON.stringify(args)}`)

  return getExecOutput('nf-test', args, {
    ignoreReturnCode: true,
    silent: true
  })
}
