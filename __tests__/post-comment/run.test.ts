// Only the network layer is mocked ('@actions/core' and '@actions/github'):
// the validation and decision logic in run.ts is the thing under test here.
// artifact.ts, validate.ts, body.ts and marker.ts already have their own
// direct, unmocked tests.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'
import { MAX_COMMENT_BODY_LENGTH } from '../../src/actions/post-comment/body.js'

const getInput = jest.fn<(name: string) => string>()
const info = jest.fn()
const write = jest.fn(() => Promise.resolve())
const summary: Record<string, jest.Mock> = {}
summary.addHeading = jest.fn(() => summary)
summary.addRaw = jest.fn(() => summary)
summary.write = write

jest.unstable_mockModule('@actions/core', () => ({
  getInput,
  info,
  warning: jest.fn(),
  summary
}))

interface Pull {
  number: number
  state: string
}

interface Comment {
  id: number
  user: { login: string } | null
  body: string
}

const listPullRequestsAssociatedWithCommit =
  jest.fn<(params: unknown) => Promise<{ data: Pull[] }>>()
const listComments =
  jest.fn<(params: unknown) => Promise<{ data: Comment[] }>>()
const createComment =
  jest.fn<(params: unknown) => Promise<{ data: { id: number } }>>()
const updateComment =
  jest.fn<(params: unknown) => Promise<{ data: { id: number } }>>()
const getAuthenticated = jest.fn<() => Promise<{ data: { login: string } }>>()

/** The 403 GET /user gives for an installation token, such as GITHUB_TOKEN. */
function forbidden(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error('Resource not accessible by integration'), {
      status: 403
    })
  )
}

// A minimal stand-in for Octokit's own paginate(): the fakes below only
// ever return one page, so calling the endpoint once and reading its
// `.data` is enough to exercise run.ts's own pagination call correctly.
const paginate = jest.fn(
  async (
    fn: (params: unknown) => Promise<{ data: unknown }>,
    params: unknown
  ) => (await fn(params)).data
)

const fakeOctokit = {
  paginate,
  rest: {
    repos: { listPullRequestsAssociatedWithCommit },
    issues: { listComments, createComment, updateComment },
    users: { getAuthenticated }
  }
}

const getOctokit = jest.fn(() => fakeOctokit)

jest.unstable_mockModule('@actions/github', () => ({
  getOctokit,
  context: { repo: { owner: 'nf-core', repo: 'demo' } }
}))

const { run } = await import('../../src/actions/post-comment/run.js')

const HEAD_SHA = 'a'.repeat(40)

function setInputs(overrides: Record<string, string> = {}): void {
  const values: Record<string, string> = {
    'artifact-path': '',
    'github-token': 'token',
    'head-sha': HEAD_SHA,
    ...overrides
  }
  getInput.mockImplementation((name) => values[name] ?? '')
}

/** An open pull request associated with HEAD_SHA, as the API would report it. */
function openPr(number: number): { number: number; state: string } {
  return { number, state: 'open' }
}

describe('post-comment run()', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'post-comment-run-'))
    listPullRequestsAssociatedWithCommit.mockResolvedValue({
      data: [openPr(42)]
    })
    listComments.mockResolvedValue({ data: [] })
    createComment.mockResolvedValue({ data: { id: 1 } })
    updateComment.mockResolvedValue({ data: { id: 1 } })
    // The default token in these tests behaves like GITHUB_TOKEN: GET /user
    // 403s, so run() falls back to the fixed 'github-actions[bot]' login.
    getAuthenticated.mockImplementation(forbidden)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeArtifact(files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
  }

  it('creates a comment for a valid artifact', async () => {
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'All good.\n'
    })
    setInputs({ 'artifact-path': dir })

    await run()

    expect(createComment).toHaveBeenCalledTimes(1)
    expect(updateComment).not.toHaveBeenCalled()
    const call = createComment.mock.calls[0]?.[0] as {
      owner: string
      repo: string
      issue_number: number
      body: string
    }
    expect(call.owner).toBe('nf-core')
    expect(call.repo).toBe('demo')
    expect(call.issue_number).toBe(42)
    expect(call.body).toContain('<!-- nf-core-actions:pr-comment:lint -->')
    expect(call.body).toContain('All good.')
  })

  it('updates, not duplicates, when a comment with the same marker already exists', async () => {
    listComments.mockResolvedValue({
      data: [
        {
          id: 99,
          user: { login: 'github-actions[bot]' },
          body: '<!-- nf-core-actions:pr-comment:lint -->\nOld report.'
        }
      ]
    })
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'New report.\n'
    })
    setInputs({ 'artifact-path': dir })

    await run()

    expect(updateComment).toHaveBeenCalledTimes(1)
    expect(createComment).not.toHaveBeenCalled()
    const call = updateComment.mock.calls[0]?.[0] as {
      comment_id: number
      body: string
    }
    expect(call.comment_id).toBe(99)
    expect(call.body).toContain('New report.')
  })

  it('does not match a comment where a lookalike marker is buried mid-body, only where it leads', async () => {
    // Simulates the marker-hijack scenario the anchoring fix closes: an
    // earlier comment (posted by the bot itself) whose own real marker is
    // for a different header, with something shaped like *this* header's
    // marker buried later in the body, must not be found by this header's
    // search. Before anchoring on startsWith(), comment.body.includes()
    // would have matched here and overwritten the other header's report.
    listComments.mockResolvedValue({
      data: [
        {
          id: 99,
          user: { login: 'github-actions[bot]' },
          body:
            '<!-- nf-core-actions:pr-comment:template-version -->\n' +
            'Template version report.\n' +
            '<!-- nf-core-actions:pr-comment:lint -->\n' +
            'Not actually the lint comment.'
        }
      ]
    })
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'New lint report.\n'
    })
    setInputs({ 'artifact-path': dir })

    await run()

    expect(createComment).toHaveBeenCalledTimes(1)
    expect(updateComment).not.toHaveBeenCalled()
  })

  it('matches a comment whose marker leads at position zero', async () => {
    listComments.mockResolvedValue({
      data: [
        {
          id: 99,
          user: { login: 'github-actions[bot]' },
          body: '<!-- nf-core-actions:pr-comment:lint -->\nOld report.'
        }
      ]
    })
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'New report.\n'
    })
    setInputs({ 'artifact-path': dir })

    await run()

    expect(updateComment).toHaveBeenCalledTimes(1)
    expect(createComment).not.toHaveBeenCalled()
  })

  it('does not match a comment with the same marker text posted by someone else', async () => {
    listComments.mockResolvedValue({
      data: [
        {
          id: 99,
          user: { login: 'a-contributor' },
          body: '<!-- nf-core-actions:pr-comment:lint -->\nNot actually ours.'
        }
      ]
    })
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'New report.\n'
    })
    setInputs({ 'artifact-path': dir })

    await run()

    expect(createComment).toHaveBeenCalledTimes(1)
    expect(updateComment).not.toHaveBeenCalled()
  })

  it('rejects a pull request number the triggering commit is not associated with', async () => {
    listPullRequestsAssociatedWithCommit.mockResolvedValue({
      data: [openPr(7)]
    })
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'All good.\n'
    })
    setInputs({ 'artifact-path': dir })

    await expect(run()).rejects.toThrow(/is associated with pull request/)
    expect(createComment).not.toHaveBeenCalled()
    expect(updateComment).not.toHaveBeenCalled()
  })

  it('rejects a header with characters outside the allowed set', async () => {
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint!\n',
      'comment.md': 'All good.\n'
    })
    setInputs({ 'artifact-path': dir })

    await expect(run()).rejects.toThrow(/header\.txt must match/)
    expect(listPullRequestsAssociatedWithCommit).not.toHaveBeenCalled()
    expect(createComment).not.toHaveBeenCalled()
  })

  it('caps an oversized comment.md instead of failing', async () => {
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'x'.repeat(MAX_COMMENT_BODY_LENGTH * 2)
    })
    setInputs({ 'artifact-path': dir })

    await run()

    expect(createComment).toHaveBeenCalledTimes(1)
    const call = createComment.mock.calls[0]?.[0] as { body: string }
    expect(call.body.length).toBe(MAX_COMMENT_BODY_LENGTH)
    expect(call.body).toContain('truncated')
  })

  it('is a clean no-op when comment.md is absent', async () => {
    writeArtifact({ 'pr_number.txt': '42\n', 'header.txt': 'lint\n' })
    setInputs({ 'artifact-path': dir })

    await expect(run()).resolves.toBeUndefined()

    expect(listPullRequestsAssociatedWithCommit).not.toHaveBeenCalled()
    expect(createComment).not.toHaveBeenCalled()
    expect(updateComment).not.toHaveBeenCalled()
  })

  it('is a clean no-op when the artifact directory is entirely absent', async () => {
    setInputs({ 'artifact-path': join(dir, 'does-not-exist') })

    await expect(run()).resolves.toBeUndefined()

    expect(listPullRequestsAssociatedWithCommit).not.toHaveBeenCalled()
    expect(createComment).not.toHaveBeenCalled()
    expect(updateComment).not.toHaveBeenCalled()
  })

  it('is a clean no-op, not a failure, when the commit has no associated pull request', async () => {
    listPullRequestsAssociatedWithCommit.mockResolvedValue({ data: [] })
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'All good.\n'
    })
    setInputs({ 'artifact-path': dir })

    await expect(run()).resolves.toBeUndefined()

    expect(createComment).not.toHaveBeenCalled()
    expect(updateComment).not.toHaveBeenCalled()
  })

  it('is a clean no-op, not an overwrite, when comment.md is blank', async () => {
    listComments.mockResolvedValue({
      data: [
        {
          id: 99,
          user: { login: 'github-actions[bot]' },
          body: '<!-- nf-core-actions:pr-comment:lint -->\nA real, earlier report.'
        }
      ]
    })
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': '   \n'
    })
    setInputs({ 'artifact-path': dir })

    await expect(run()).resolves.toBeUndefined()

    expect(listPullRequestsAssociatedWithCommit).not.toHaveBeenCalled()
    expect(createComment).not.toHaveBeenCalled()
    expect(updateComment).not.toHaveBeenCalled()
  })

  it('sanitises the body before posting: mentions and image embeds are neutralised', async () => {
    writeArtifact({
      'pr_number.txt': '42\n',
      'header.txt': 'lint\n',
      'comment.md': 'cc @a-maintainer\n![tracker](https://example.com/x.png)\n'
    })
    setInputs({ 'artifact-path': dir })

    await run()

    const call = createComment.mock.calls[0]?.[0] as { body: string }
    expect(call.body).toContain('`@a-maintainer`')
    expect(call.body).not.toContain('![tracker]')
    expect(call.body).toContain('[tracker](https://example.com/x.png)')
  })

  describe('resolving the authenticated identity', () => {
    it('matches its own earlier comment by the login GET /user returns for a personal access token', async () => {
      getAuthenticated.mockResolvedValue({ data: { login: 'a-pat-owner' } })
      listComments.mockResolvedValue({
        data: [
          {
            id: 99,
            user: { login: 'a-pat-owner' },
            body: '<!-- nf-core-actions:pr-comment:lint -->\nOld report.'
          }
        ]
      })
      writeArtifact({
        'pr_number.txt': '42\n',
        'header.txt': 'lint\n',
        'comment.md': 'New report.\n'
      })
      setInputs({ 'artifact-path': dir })

      await run()

      expect(updateComment).toHaveBeenCalledTimes(1)
      expect(createComment).not.toHaveBeenCalled()
    })

    it('falls back to the fixed bot login when GET /user 403s, as it does for GITHUB_TOKEN', async () => {
      getAuthenticated.mockImplementation(forbidden)
      listComments.mockResolvedValue({
        data: [
          {
            id: 99,
            user: { login: 'github-actions[bot]' },
            body: '<!-- nf-core-actions:pr-comment:lint -->\nOld report.'
          }
        ]
      })
      writeArtifact({
        'pr_number.txt': '42\n',
        'header.txt': 'lint\n',
        'comment.md': 'New report.\n'
      })
      setInputs({ 'artifact-path': dir })

      await run()

      expect(updateComment).toHaveBeenCalledTimes(1)
      expect(createComment).not.toHaveBeenCalled()
    })

    it('does not swallow a GET /user error that is not the expected 403', async () => {
      getAuthenticated.mockRejectedValue(
        Object.assign(new Error('server error'), { status: 500 })
      )
      writeArtifact({
        'pr_number.txt': '42\n',
        'header.txt': 'lint\n',
        'comment.md': 'All good.\n'
      })
      setInputs({ 'artifact-path': dir })

      await expect(run()).rejects.toThrow(/server error/)
      expect(createComment).not.toHaveBeenCalled()
    })
  })
})
