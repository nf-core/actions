import { describe, expect, it, jest } from '@jest/globals'

const getCollaboratorPermissionLevel =
  jest.fn<(params: unknown) => Promise<{ data: { permission: string } }>>()
const listReviewsEndpoint =
  jest.fn<(params: unknown) => Promise<{ data: unknown[] }>>()
const listEventsForTimeline =
  jest.fn<(params: unknown) => Promise<{ data: unknown[] }>>()
// A minimal stand-in for Octokit's own paginate(): the fake endpoint above
// only ever returns one page, so calling it once and reading its `.data` is
// enough to exercise listReviews()'s own pagination call correctly.
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

const { hasWritePermission, listReviews, latestBaseRefChangedAt } =
  await import('../../src/actions/authorize-launch/api.js')

describe('hasWritePermission', () => {
  it('is true for write', async () => {
    getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: 'write' }
    })
    await expect(
      hasWritePermission('a-token', 'nf-core', 'rnaseq', 'alice')
    ).resolves.toBe(true)
  })

  it('is true for admin', async () => {
    getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: 'admin' }
    })
    await expect(
      hasWritePermission('a-token', 'nf-core', 'rnaseq', 'alice')
    ).resolves.toBe(true)
  })

  it('is false for read', async () => {
    getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: 'read' }
    })
    await expect(
      hasWritePermission('a-token', 'nf-core', 'rnaseq', 'alice')
    ).resolves.toBe(false)
  })

  it('is false, not an error, for a 404 (not a collaborator)', async () => {
    getCollaboratorPermissionLevel.mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 })
    )
    await expect(
      hasWritePermission('a-token', 'nf-core', 'rnaseq', 'alice')
    ).resolves.toBe(false)
  })

  it('propagates any other failure', async () => {
    getCollaboratorPermissionLevel.mockRejectedValue(
      Object.assign(new Error('rate limited'), { status: 403 })
    )
    await expect(
      hasWritePermission('a-token', 'nf-core', 'rnaseq', 'alice')
    ).rejects.toThrow('rate limited')
  })
})

describe('listReviews', () => {
  it('maps id, state, login and submittedAt, dropping a deleted user review', async () => {
    listReviewsEndpoint.mockResolvedValue({
      data: [
        {
          id: 1,
          state: 'APPROVED',
          user: { login: 'alice' },
          submitted_at: '2024-01-01T00:00:00Z'
        },
        { id: 2, state: 'APPROVED', user: null, submitted_at: null }
      ]
    })

    const reviews = await listReviews('a-token', 'nf-core', 'rnaseq', 42)

    expect(reviews).toEqual([
      {
        id: 1,
        state: 'APPROVED',
        login: 'alice',
        submittedAt: '2024-01-01T00:00:00Z'
      }
    ])
  })

  it('defaults a missing submitted_at to an empty string', async () => {
    listReviewsEndpoint.mockResolvedValue({
      data: [{ id: 1, state: 'PENDING', user: { login: 'alice' } }]
    })

    const reviews = await listReviews('a-token', 'nf-core', 'rnaseq', 42)

    expect(reviews[0]?.submittedAt).toBe('')
  })
})

describe('latestBaseRefChangedAt', () => {
  it('returns undefined when the timeline has no base_ref_changed event', async () => {
    listEventsForTimeline.mockResolvedValue({
      data: [{ event: 'commented', created_at: '2024-01-01T00:00:00Z' }]
    })

    await expect(
      latestBaseRefChangedAt('a-token', 'nf-core', 'rnaseq', 42)
    ).resolves.toBeUndefined()
  })

  it('returns the most recent base_ref_changed event, in timeline order', async () => {
    listEventsForTimeline.mockResolvedValue({
      data: [
        { event: 'base_ref_changed', created_at: '2024-01-01T00:00:00Z' },
        { event: 'commented', created_at: '2024-01-02T00:00:00Z' },
        { event: 'base_ref_changed', created_at: '2024-01-03T00:00:00Z' }
      ]
    })

    await expect(
      latestBaseRefChangedAt('a-token', 'nf-core', 'rnaseq', 42)
    ).resolves.toBe('2024-01-03T00:00:00Z')
  })
})
