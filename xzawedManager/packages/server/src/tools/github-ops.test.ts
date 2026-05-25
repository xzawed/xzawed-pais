import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGithubOpsHandler } from './github-ops.js'

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      repos: {
        createForAuthenticatedUser: vi.fn().mockResolvedValue({
          data: { id: 1, name: 'my-repo', full_name: 'xzawed/my-repo', private: false, default_branch: 'main' },
        }),
        listForAuthenticatedUser: vi.fn().mockResolvedValue({ data: [] }),
        listBranches: vi.fn().mockResolvedValue({ data: [] }),
        merge: vi.fn().mockResolvedValue({ data: { sha: 'merge-sha' } }),
      },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'abc123' } } }),
        createRef: vi.fn().mockResolvedValue({ data: {} }),
        getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: 'tree123' } } }),
        createBlob: vi.fn().mockResolvedValue({ data: { sha: 'blob123' } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: 'newtree123' } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: 'newcommit123' } }),
        updateRef: vi.fn().mockResolvedValue({ data: {} }),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: { number: 1, html_url: 'https://github.com/xzawed/my-repo/pull/1', title: 'feat' },
        }),
      },
      issues: {
        create: vi.fn().mockResolvedValue({
          data: { number: 2, html_url: 'https://github.com/xzawed/my-repo/issues/2', title: 'Issue' },
        }),
      },
    },
  })),
}))

describe('github-ops handler', () => {
  const handler = createGithubOpsHandler('ghp_testtoken')

  it('handler name이 github_ops이다', () => {
    expect(handler.name).toBe('github_ops')
  })

  it('createRepo 액션이 레포 정보를 반환한다', async () => {
    const result = await handler.execute(
      { action: 'createRepo', repoName: 'my-repo', private: false, description: 'test' },
      'session-1'
    )
    expect(result).toMatchObject({ name: 'my-repo' })
  })

  it('createBranch 액션이 브랜치를 생성한다', async () => {
    const result = await handler.execute(
      { action: 'createBranch', owner: 'xzawed', repo: 'my-repo', branch: 'feat/test', fromBranch: 'main' },
      'session-1'
    )
    expect(result).toMatchObject({ branch: 'feat/test' })
  })

  it('createPR 액션이 PR URL을 반환한다', async () => {
    const result = await handler.execute(
      { action: 'createPR', owner: 'xzawed', repo: 'my-repo', title: 'feat', head: 'feat/test', base: 'main', body: '' },
      'session-1'
    ) as { url: string }
    expect(result.url).toContain('pull/1')
  })

  it('createIssue 액션이 이슈 URL을 반환한다', async () => {
    const result = await handler.execute(
      { action: 'createIssue', owner: 'xzawed', repo: 'my-repo', title: 'Bug', body: 'desc' },
      'session-1'
    ) as { url: string }
    expect(result.url).toContain('issues/2')
  })

  it('commitAndPush — 절대 경로 파일 경로 시 Error throw', async () => {
    await expect(
      handler.execute(
        { action: 'commitAndPush', owner: 'xzawed', repo: 'my-repo', branch: 'main', message: 'test',
          files: [{ path: '/etc/passwd', content: 'x' }] },
        'session-1'
      )
    ).rejects.toThrow('Absolute paths not allowed')
  })

  it('commitAndPush — files 빈 배열 시 Error throw', async () => {
    await expect(
      handler.execute(
        { action: 'commitAndPush', owner: 'xzawed', repo: 'my-repo', branch: 'main', message: 'test',
          files: [] },
        'session-1'
      )
    ).rejects.toThrow('files array must not be empty')
  })
})
