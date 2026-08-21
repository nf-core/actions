import { describe, expect, it } from '@jest/globals'
import { compareVersions } from '../../src/actions/template-version/version.js'

describe('compareVersions', () => {
  it('reports behind when the pipeline trails the latest release', () => {
    expect(compareVersions('4.0.3', '4.1.0')).toEqual({
      status: 'behind',
      pipelineVersion: '4.0.3'
    })
  })

  it('reports up-to-date when the pipeline matches the latest release', () => {
    expect(compareVersions('4.1.0', '4.1.0')).toEqual({ status: 'up-to-date' })
  })

  it('reports up-to-date when the pipeline is ahead of the latest release', () => {
    expect(compareVersions('4.2.0', '4.1.0')).toEqual({ status: 'up-to-date' })
  })

  it('orders 2.10 after 2.9 numerically, not as strings', () => {
    // A naive string compare puts '2.10' before '2.9' ('1' < '9'). Both
    // directions are asserted, so a regression that swapped the operands
    // would also be caught.
    expect(compareVersions('2.9', '2.10')).toEqual({
      status: 'behind',
      pipelineVersion: '2.9.0'
    })
    expect(compareVersions('2.10', '2.9')).toEqual({ status: 'up-to-date' })
  })

  it('treats a development suffix as equal to the same release, not behind it', () => {
    expect(compareVersions('3.27.0dev', '3.27.0')).toEqual({
      status: 'up-to-date'
    })
  })

  it('still reports behind for a development suffix on an older line', () => {
    expect(compareVersions('3.27.0dev', '4.0.0')).toEqual({
      status: 'behind',
      pipelineVersion: '3.27.0'
    })
  })

  it('coerces the returned pipelineVersion to bare digits and dots, dropping everything else', () => {
    // The same class of payload as the injection this guards against:
    // coerce() finds '1.0.0' inside the string and drops the rest. Only
    // that coerced form may ever reach a caller that renders it.
    const result = compareVersions('1.0.0\n\n> [!CAUTION]\n> hi', '4.1.0')
    expect(result).toEqual({ status: 'behind', pipelineVersion: '1.0.0' })
  })

  it('reports unknown for a missing pipeline version, with a reason', () => {
    const result = compareVersions('', '4.1.0')
    if (result.status !== 'unknown') throw new Error('expected unknown')
    expect(result.reason).toMatch(/not set/)
  })

  it('reports unknown for whitespace-only, the same as missing', () => {
    expect(compareVersions('   ', '4.1.0').status).toBe('unknown')
  })

  it('reports unknown for a pipeline version with no recognisable version shape', () => {
    const result = compareVersions('not-a-version', '4.1.0')
    if (result.status !== 'unknown') throw new Error('expected unknown')
    expect(result.reason).toMatch(/not-a-version/)
  })

  it('throws if the latest release tag itself is not version-shaped', () => {
    expect(() => compareVersions('4.0.3', 'not-a-version')).toThrow(
      /latest nf-core\/tools release tag/
    )
  })

  it('tolerates a leading v on the latest release tag', () => {
    expect(compareVersions('4.0.3', 'v4.1.0')).toEqual({
      status: 'behind',
      pipelineVersion: '4.0.3'
    })
  })

  it('tolerates a two-component pipeline version', () => {
    expect(compareVersions('2.10', '2.10.0')).toEqual({ status: 'up-to-date' })
  })
})
