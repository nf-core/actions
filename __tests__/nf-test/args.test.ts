import { describe, expect, it } from '@jest/globals'
import {
  assertProfile,
  assertShardWithinTotal,
  buildArgs,
  parseExtraArgs,
  parseShardNumber,
  parseVerbose
} from '../../src/actions/nf-test/args.js'

const BASE = {
  profile: 'docker',
  shard: 1,
  totalShards: 3,
  tags: '',
  changedSince: 'HEAD^',
  verbose: true,
  extraArgs: []
}

describe('buildArgs', () => {
  it('builds the argv for minimum inputs', () => {
    expect(buildArgs(BASE, '/tmp/x/test.tap')).toEqual([
      'test',
      '--profile=+docker',
      '--ci',
      '--changed-since',
      'HEAD^',
      '--verbose',
      '--tap=/tmp/x/test.tap',
      '--shard',
      '1/3'
    ])
  })

  it('adds --tag as its own argument when tags is set', () => {
    const args = buildArgs({ ...BASE, tags: 'my_tag' }, '/tmp/x/test.tap')
    expect(args).toEqual([
      'test',
      '--profile=+docker',
      '--tag',
      'my_tag',
      '--ci',
      '--changed-since',
      'HEAD^',
      '--verbose',
      '--tap=/tmp/x/test.tap',
      '--shard',
      '1/3'
    ])
  })

  it('omits --verbose when verbose is false', () => {
    const args = buildArgs({ ...BASE, verbose: false }, '/tmp/x/test.tap')
    expect(args).toEqual([
      'test',
      '--profile=+docker',
      '--ci',
      '--changed-since',
      'HEAD^',
      '--tap=/tmp/x/test.tap',
      '--shard',
      '1/3'
    ])
  })

  it('omits --changed-since entirely when changedSince is empty', () => {
    const args = buildArgs({ ...BASE, changedSince: '' }, '/tmp/x/test.tap')
    expect(args).toEqual([
      'test',
      '--profile=+docker',
      '--ci',
      '--verbose',
      '--tap=/tmp/x/test.tap',
      '--shard',
      '1/3'
    ])
  })

  it('appends each extra-args element as its own argv element', () => {
    const args = buildArgs(
      { ...BASE, extraArgs: ['--follow-dependencies', '--filter', 'process'] },
      '/tmp/x/test.tap'
    )
    expect(args).toEqual([
      'test',
      '--profile=+docker',
      '--ci',
      '--changed-since',
      'HEAD^',
      '--verbose',
      '--tap=/tmp/x/test.tap',
      '--shard',
      '1/3',
      '--follow-dependencies',
      '--filter',
      'process'
    ])
  })

  it('passes a tags value containing shell metacharacters through as one unmodified argv element', () => {
    const dangerousTag = 'foo; rm -rf / #\ninjected'
    const args = buildArgs({ ...BASE, tags: dangerousTag }, '/tmp/x/test.tap')
    expect(args.filter((arg) => arg === dangerousTag)).toHaveLength(1)
  })
})

describe('parseShardNumber', () => {
  it('accepts a positive integer', () => {
    expect(parseShardNumber('2', 'shard')).toBe(2)
  })

  it.each(['0', '-1', '2.5', 'many'])('rejects %s', (raw) => {
    expect(() => parseShardNumber(raw, 'shard')).toThrow(/positive integer/)
  })
})

describe('assertShardWithinTotal', () => {
  it('accepts shard equal to total-shards', () => {
    expect(() => assertShardWithinTotal(3, 3)).not.toThrow()
  })

  it('rejects shard greater than total-shards', () => {
    expect(() => assertShardWithinTotal(4, 3)).toThrow(
      /shard \(4\) must not be greater than total-shards \(3\)/
    )
  })
})

describe('assertProfile', () => {
  it('accepts a non-empty profile', () => {
    expect(() => assertProfile('docker')).not.toThrow()
  })

  it('rejects an empty profile', () => {
    expect(() => assertProfile('')).toThrow(/profile must not be empty/)
  })

  it('rejects a whitespace-only profile', () => {
    expect(() => assertProfile('   ')).toThrow(/profile must not be empty/)
  })
})

describe('parseVerbose', () => {
  it('defaults to true when empty', () => {
    expect(parseVerbose('')).toBe(true)
  })

  it('accepts true and false, case-insensitively', () => {
    expect(parseVerbose('true')).toBe(true)
    expect(parseVerbose('False')).toBe(false)
  })

  it('rejects anything else', () => {
    expect(() => parseVerbose('yes')).toThrow(/must be 'true' or 'false'/)
  })
})

describe('parseExtraArgs', () => {
  it('returns an empty array when empty', () => {
    expect(parseExtraArgs('')).toEqual([])
  })

  it('parses a JSON array of strings', () => {
    expect(
      parseExtraArgs('["--follow-dependencies","--filter-tests"]')
    ).toEqual(['--follow-dependencies', '--filter-tests'])
  })

  it('rejects a plain string', () => {
    expect(() => parseExtraArgs('--follow-dependencies')).toThrow(
      /must be a JSON array of strings/
    )
  })

  it('rejects a JSON array containing a non-string', () => {
    expect(() => parseExtraArgs('["--follow-dependencies", 5]')).toThrow(
      /must be a JSON array of strings/
    )
  })

  it('rejects a JSON object', () => {
    expect(() => parseExtraArgs('{"a":"b"}')).toThrow(
      /must be a JSON array of strings/
    )
  })

  describe('reserved flags', () => {
    it.each([
      '--tap',
      '--shard',
      '--profile',
      '--tag',
      '--changed-since',
      '--verbose',
      '--ci'
    ])('rejects %s in --flag value form', (flag) => {
      expect(() =>
        parseExtraArgs(JSON.stringify([flag, 'some-value']))
      ).toThrow(new RegExp(`must not set '${flag}'`))
    })

    it.each([
      '--tap',
      '--shard',
      '--profile',
      '--tag',
      '--changed-since',
      '--verbose',
      '--ci'
    ])('rejects %s= in --flag=value form', (flag) => {
      expect(() =>
        parseExtraArgs(JSON.stringify([`${flag}=some-value`]))
      ).toThrow(new RegExp(`must not set '${flag}'`))
    })

    it('still allows an unrelated flag through', () => {
      expect(parseExtraArgs('["--follow-dependencies"]')).toEqual([
        '--follow-dependencies'
      ])
    })
  })
})
