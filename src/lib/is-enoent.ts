// Shared by every action that treats a missing file as a normal case, not a
// crash (read-config's config file, nf-test's TAP file, validate-patch's
// patch file).

/**
 * Node's fs errors always carry a string .code, regardless of which realm
 * constructed them. Checking that shape, rather than `instanceof Error`,
 * avoids a cross-realm false negative under Jest's experimental VM modules.
 */
export function isEnoent(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
