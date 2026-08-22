// Only the network layer is mocked ('@actions/core' and '@actions/github'):
// decide.ts and api.ts already have their own direct, unmocked tests. This
// exercises run.ts's own wiring: input reading, event branching, and the
// order permission checks happen in.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const getInput =
  jest.fn<(name: string, options?: { required?: boolean }) => string>()
const setOutput = jest.fn<(name: string, value: string) => void>()
const info = jest.fn()
const write = jest.fn(() => Promise.resolve())
const summary: Record<string, jest.Mock> = {}
summary.addHeading = jest.fn(() => summary)
summary.addTable = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({
  getInput,
  setOutput,
  info,
  summary
}))

const getCollaboratorPermissionLevel =
  jest.fn<(params: unknown) => Promise<{ data: { permission: string } }>>()
const listReviewsEndpoint =
  jest.fn<(params: unknown) => Promise<{ data: unknown[] }>>()
const listEventsForTimeline =
  jest.fn<(params: unknown) => Promise<{ data: unknown[] }>>()
// A minimal stand-in for Octokit's own paginate(): the fake endpoint above
// only ever returns one page, so calling it once and reading its `.data` is
// enough to exercise run.ts's own pagination call correctly.
const paginate = jest.fn(
  async (
    fn: (params: unknown) => Promise<{ data: unknown[] }>,
    params: unknown
  ) => (await fn(params)).data
)
const fakeOctokit = {
  paginate,
  rest: {
    repos: { getCollaboratorPermissionLevel },
    pulls: { listReviews: listReviewsEndpoint },
    issues: { listEventsForTimeline }
  }
}
const getOctokit = jest.fn(() => fakeOctokit)

jest.unstable_mockModule('@actions/github', () => ({ getOctokit }))

const { run } = await import('../../src/actions/authorize-launch/run.js')

function setInputs(overrides: Record<string, string> = {}): void {
  const values: Record<string, string> = {
    'event-name': 'pull_request_review',
    'github-token': 'a-token',
    repository: 'nf-core/rnaseq',
    sha: 'a'.repeat(40),
    'required-approvals': '2',
    'review-state': 'approved',
    'review-user': 'bob',
    'review-id': '100',
    'pr-number': '42',
    'pr-author': 'pr-author',
    'base-ref': 'master',
    ...overrides
  }
  getInput.mockImplementation((name, options) => {
    const value = values[name] ?? ''
    if (options?.required && !value) {
      throw new Error(`Input required and not supplied: ${name}`)
    }
    return value
  })
}

/** Maps login -> collaborator permission ('write', 'read', ...) for getCollaboratorPermissionLevel. Any login not listed gets 'none'. */
function permissionOf(logins: Record<string, string>): void {
  getCollaboratorPermissionLevel.mockImplementation(
    async (params: unknown) => ({
      data: {
        permission: logins[(params as { username: string }).username] ?? 'none'
      }
    })
  )
}

beforeEach(() => {
  getInput.mockReset()
  setOutput.mockClear()
  getCollaboratorPermissionLevel.mockReset()
  listReviewsEndpoint.mockReset()
  listReviewsEndpoint.mockResolvedValue({ data: [] })
  listEventsForTimeline.mockReset()
  listEventsForTimeline.mockResolvedValue({ data: [] })
})

describe('authorize-launch run()', () => {
  it('always launches on workflow_dispatch, using the sha, with no API call', async () => {
    setInputs({ 'event-name': 'workflow_dispatch' })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'true')
    expect(setOutput).toHaveBeenCalledWith('revision', 'a'.repeat(40))
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled()
  })

  it('defaults review-id and pr-number to 0 when absent on a non-review event', async () => {
    setInputs({
      'event-name': 'workflow_dispatch',
      'review-id': '',
      'pr-number': ''
    })

    await expect(run()).resolves.toBeUndefined()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'true')
  })

  it('always launches on a published release, using the sha', async () => {
    setInputs({ 'event-name': 'release' })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'true')
    expect(setOutput).toHaveBeenCalledWith('revision', 'a'.repeat(40))
  })

  it('does not launch, with no API call, when the review is not approved', async () => {
    setInputs({ 'review-state': 'commented' })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled()
  })

  it('does not launch, with no API call, when the base branch is not a release branch', async () => {
    setInputs({ 'base-ref': 'dev' })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled()
  })

  it('does not launch, with no API call, for a self-approval by the pull request author', async () => {
    setInputs({ 'review-user': 'pr-author' })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled()
  })

  it('does not launch when the reviewer lacks write permission, and never lists reviews', async () => {
    setInputs()
    permissionOf({ bob: 'read' })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
    expect(listReviewsEndpoint).not.toHaveBeenCalled()
  })

  it('does not launch below the required approval count', async () => {
    setInputs({ 'required-approvals': '2' })
    permissionOf({ bob: 'write' })
    listReviewsEndpoint.mockResolvedValue({ data: [] })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
  })

  it('launches exactly at the required approval count, with revision dev', async () => {
    setInputs({ 'required-approvals': '2' })
    permissionOf({ bob: 'write', alice: 'write' })
    listReviewsEndpoint.mockResolvedValue({
      data: [{ id: 1, state: 'APPROVED', user: { login: 'alice' } }]
    })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'true')
    expect(setOutput).toHaveBeenCalledWith('revision', 'dev')
  })

  it('does not launch again for a third approval beyond the threshold', async () => {
    setInputs({ 'required-approvals': '2', 'review-user': 'carol' })
    permissionOf({ carol: 'write', bob: 'write', alice: 'write' })
    listReviewsEndpoint.mockResolvedValue({
      data: [
        { id: 1, state: 'APPROVED', user: { login: 'alice' } },
        { id: 2, state: 'APPROVED', user: { login: 'bob' } }
      ]
    })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
  })

  it('does not count an approval from someone without write permission', async () => {
    setInputs({ 'required-approvals': '2' })
    // alice approved earlier but does not have write access.
    permissionOf({ bob: 'write', alice: 'read' })
    listReviewsEndpoint.mockResolvedValue({
      data: [{ id: 1, state: 'APPROVED', user: { login: 'alice' } }]
    })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
  })

  it('counts two approvals from the same person once', async () => {
    setInputs({ 'required-approvals': '2' })
    permissionOf({ bob: 'write', alice: 'write' })
    listReviewsEndpoint.mockResolvedValue({
      data: [
        { id: 1, state: 'APPROVED', user: { login: 'alice' } },
        { id: 2, state: 'APPROVED', user: { login: 'alice' } }
      ]
    })

    await run()

    // One distinct trusted approver (alice) before bob's: with
    // required-approvals=2, this is exactly the crossing.
    expect(setOutput).toHaveBeenCalledWith('should-run', 'true')
  })

  it('does not count an approval given while the pull request targeted a different base branch', async () => {
    setInputs({ 'required-approvals': '2' })
    permissionOf({ bob: 'write', alice: 'write' })
    listReviewsEndpoint.mockResolvedValue({
      data: [
        {
          id: 1,
          state: 'APPROVED',
          user: { login: 'alice' },
          submitted_at: '2024-01-01T00:00:00Z'
        }
      ]
    })
    // The pull request was retargeted after alice's approval.
    listEventsForTimeline.mockResolvedValue({
      data: [{ event: 'base_ref_changed', created_at: '2024-01-02T00:00:00Z' }]
    })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
  })

  it('counts an approval given after the pull request was last retargeted', async () => {
    setInputs({ 'required-approvals': '2' })
    permissionOf({ bob: 'write', alice: 'write' })
    listReviewsEndpoint.mockResolvedValue({
      data: [
        {
          id: 1,
          state: 'APPROVED',
          user: { login: 'alice' },
          submitted_at: '2024-01-03T00:00:00Z'
        }
      ]
    })
    listEventsForTimeline.mockResolvedValue({
      data: [{ event: 'base_ref_changed', created_at: '2024-01-02T00:00:00Z' }]
    })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'true')
  })

  it('does not launch a repeat approval by the same reviewer', async () => {
    setInputs({ 'required-approvals': '2' })
    permissionOf({ bob: 'write' })
    listReviewsEndpoint.mockResolvedValue({
      data: [{ id: 1, state: 'APPROVED', user: { login: 'bob' } }]
    })

    await run()

    expect(setOutput).toHaveBeenCalledWith('should-run', 'false')
  })

  it('fails clearly, naming the event, for an unsupported event', async () => {
    setInputs({ 'event-name': 'issue_comment' })

    await expect(run()).rejects.toThrow(/issue_comment/)
  })

  it('fails clearly when a pull_request_review input is missing', async () => {
    setInputs({ 'pr-author': '' })

    await expect(run()).rejects.toThrow(/pr-author/)
  })

  it('fails clearly when required-approvals is not a positive integer', async () => {
    setInputs({ 'required-approvals': '0' })

    await expect(run()).rejects.toThrow(/positive integer/)
  })

  it('rejects a repository input that is not owner/repo', async () => {
    setInputs({ repository: 'not-a-repo-slug' })

    await expect(run()).rejects.toThrow(/owner\/repo/)
  })
})
