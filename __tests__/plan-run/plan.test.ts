import { describe, expect, it } from '@jest/globals'
import { parseProfiles, planRun } from '../../src/actions/plan-run/plan.js'

const ALL = ['conda', 'docker', 'singularity']

describe('parseProfiles', () => {
  it('parses a JSON array of strings', () => {
    expect(parseProfiles('["docker","singularity"]')).toEqual([
      'docker',
      'singularity'
    ])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseProfiles('not json')).toThrow(
      /profiles must be a JSON array/
    )
  })

  it('rejects a JSON value that is not an array of strings', () => {
    expect(() => parseProfiles('{"docker":true}')).toThrow(
      /profiles must be a JSON array/
    )
    expect(() => parseProfiles('[1,2]')).toThrow(
      /profiles must be a JSON array/
    )
  })

  it('rejects an empty array, naming the setting', () => {
    expect(() => parseProfiles('[]')).toThrow(
      /profiles must not be an empty list/
    )
  })
})

describe('planRun', () => {
  const base = { profiles: ALL, variant: '', eventName: 'push', baseRef: '' }

  describe('full profile set', () => {
    it('runs every profile for a pull request into master with the default variant', () => {
      const plan = planRun({
        ...base,
        eventName: 'pull_request',
        baseRef: 'master'
      })
      expect(plan.testProfiles).toEqual(ALL)
      expect(plan.changedSince).toBe('HEAD^')
    })

    it('runs every profile for a pull request into main with the default variant', () => {
      const plan = planRun({
        ...base,
        eventName: 'pull_request',
        baseRef: 'main'
      })
      expect(plan.testProfiles).toEqual(ALL)
      expect(plan.changedSince).toBe('HEAD^')
    })

    it('runs every profile for a release event, and tests everything', () => {
      const plan = planRun({ ...base, eventName: 'release' })
      expect(plan.testProfiles).toEqual(ALL)
      expect(plan.changedSince).toBe('')
    })

    it('runs every profile for a workflow_dispatch event, and tests everything', () => {
      const plan = planRun({ ...base, eventName: 'workflow_dispatch' })
      expect(plan.testProfiles).toEqual(ALL)
      expect(plan.changedSince).toBe('')
    })
  })

  describe('reduced to one profile', () => {
    it('reduces an ordinary pull request into dev', () => {
      const plan = planRun({
        ...base,
        eventName: 'pull_request',
        baseRef: 'dev'
      })
      expect(plan.testProfiles).toEqual(['docker'])
      expect(plan.changedSince).toBe('HEAD^')
    })

    it('reduces a push event', () => {
      const plan = planRun({ ...base, eventName: 'push' })
      expect(plan.testProfiles).toEqual(['docker'])
      expect(plan.changedSince).toBe('HEAD^')
    })

    it('reduces a release pull request when a variant is set, since variant overrides the release check', () => {
      const plan = planRun({
        ...base,
        eventName: 'pull_request',
        baseRef: 'master',
        variant: 'arm'
      })
      expect(plan.testProfiles).toEqual(['docker'])
      expect(plan.changedSince).toBe('HEAD^')
    })

    it('reduces a release event when a variant is set, but still tests everything', () => {
      const plan = planRun({ ...base, eventName: 'release', variant: 'gpu' })
      expect(plan.testProfiles).toEqual(['docker'])
      expect(plan.changedSince).toBe('')
    })

    it('reduces a workflow_dispatch event when a variant is set, but still tests everything', () => {
      const plan = planRun({
        ...base,
        eventName: 'workflow_dispatch',
        variant: 'gpu'
      })
      expect(plan.testProfiles).toEqual(['docker'])
      expect(plan.changedSince).toBe('')
    })

    it('reduces a dev pull request with the arm variant', () => {
      const plan = planRun({
        ...base,
        eventName: 'pull_request',
        baseRef: 'dev',
        variant: 'arm'
      })
      expect(plan.testProfiles).toEqual(['docker'])
    })
  })

  describe('picking the reduced profile', () => {
    it('prefers docker regardless of list order', () => {
      const plan = planRun({
        ...base,
        profiles: ['singularity', 'docker', 'conda'],
        eventName: 'push'
      })
      expect(plan.testProfiles).toEqual(['docker'])
    })

    it('falls back to the first entry when docker is not configured', () => {
      const plan = planRun({
        ...base,
        profiles: ['singularity', 'conda'],
        eventName: 'push'
      })
      expect(plan.testProfiles).toEqual(['singularity'])
    })

    it('uses the only entry of a single-element list, full run or not', () => {
      const fullRun = planRun({
        ...base,
        profiles: ['conda'],
        eventName: 'release'
      })
      expect(fullRun.testProfiles).toEqual(['conda'])

      const reducedRun = planRun({
        ...base,
        profiles: ['conda'],
        eventName: 'push'
      })
      expect(reducedRun.testProfiles).toEqual(['conda'])
    })
  })

  it('rejects an empty profiles array, naming the setting', () => {
    expect(() => planRun({ ...base, profiles: [] })).toThrow(
      /profiles must not be an empty list/
    )
  })
})
