import { describe, expect, it } from '@jest/globals'
import { buildArgs, parseMaxShards } from '../../src/actions/get-shards/args.js'

describe('buildArgs', () => {
  it('builds the base command with no tags and the default changed-since', () => {
    expect(
      buildArgs({ profile: 'docker', tags: '', changedSince: 'HEAD^' })
    ).toEqual([
      'test',
      '--profile',
      '+docker',
      '--dry-run',
      '--ci',
      '--changed-since',
      'HEAD^'
    ])
  })

  it('adds --tag as its own argument when tags is set', () => {
    expect(
      buildArgs({ profile: 'docker', tags: 'my_tag', changedSince: 'HEAD^' })
    ).toEqual([
      'test',
      '--profile',
      '+docker',
      '--tag',
      'my_tag',
      '--dry-run',
      '--ci',
      '--changed-since',
      'HEAD^'
    ])
  })

  it('omits --changed-since entirely when changedSince is empty', () => {
    expect(
      buildArgs({ profile: 'docker', tags: '', changedSince: '' })
    ).toEqual(['test', '--profile', '+docker', '--dry-run', '--ci'])
  })

  it('uses a custom profile', () => {
    expect(
      buildArgs({ profile: 'singularity', tags: '', changedSince: '' })
    ).toEqual(['test', '--profile', '+singularity', '--dry-run', '--ci'])
  })

  it('passes a tag containing shell metacharacters through as one literal argv element', () => {
    const args = buildArgs({
      profile: 'docker',
      tags: 'foo; rm -rf /',
      changedSince: ''
    })
    expect(args).toEqual([
      'test',
      '--profile',
      '+docker',
      '--tag',
      'foo; rm -rf /',
      '--dry-run',
      '--ci'
    ])
    // The dangerous text is one array element, not split or shell-expanded.
    expect(args[4]).toBe('foo; rm -rf /')
  })

  it('passes a tag containing a command substitution through as one literal argv element', () => {
    const args = buildArgs({
      profile: 'docker',
      tags: '$(whoami)',
      changedSince: ''
    })
    expect(args).toContain('$(whoami)')
    expect(args[4]).toBe('$(whoami)')
  })
})

describe('parseMaxShards', () => {
  it('accepts a positive integer', () => {
    expect(parseMaxShards('5')).toBe(5)
  })

  it('rejects zero', () => {
    expect(() => parseMaxShards('0')).toThrow(/positive integer/)
  })

  it('rejects a negative number', () => {
    expect(() => parseMaxShards('-1')).toThrow(/positive integer/)
  })

  it('rejects a fraction', () => {
    expect(() => parseMaxShards('2.5')).toThrow(/positive integer/)
  })

  it('rejects a non-number', () => {
    expect(() => parseMaxShards('many')).toThrow(/positive integer/)
  })
})
