import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseError } from 'pg'
import type { Pool } from 'pg'
import { ProjectRepo } from '../project.repo.js'

const mockQuery = vi.fn()
const mockPool = { query: mockQuery } as unknown as Pool

function makeProjectRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'proj-1',
    user_id: 'user-1',
    name: 'Test Project',
    slug: 'test-project',
    description: null,
    github_owner: null,
    github_repo: null,
    github_branch: 'main',
    created_at: new Date(),
    updated_at: new Date(),
    workspace_type: undefined,
    local_path: null,
    repo_url: null,
    branch: undefined,
    workspace_path: null,
    push_strategy: undefined,
    ...overrides,
  }
}

describe('ProjectRepo.create()', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('영문 프로젝트명은 정상 slug로 생성된다', async () => {
    const row = makeProjectRow({ name: 'My Project', slug: 'my-project' })
    mockQuery.mockResolvedValueOnce({ rows: [row] })

    const repo = new ProjectRepo(mockPool)
    const result = await repo.create('user-1', 'My Project')

    expect(result.slug).toBe('my-project')
    expect(result.name).toBe('My Project')
    expect(result.userId).toBe('user-1')

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(params[0]).toBe('user-1')
    expect(params[1]).toBe('My Project')
    expect(params[2]).toBe('my-project')
  })

  it('한글 이름은 빈 slug가 나오므로 UUID prefix slug로 폴백된다', async () => {
    // toSlug('한글프로젝트') → '' → 'proj-<uuid>' 폴백
    // mock이 반환하는 slug는 row에서 오므로 INSERT에 전달된 slug 파라미터를 검사
    const row = makeProjectRow({ name: '한글프로젝트', slug: 'proj-abcd1234' })
    mockQuery.mockResolvedValueOnce({ rows: [row] })

    const repo = new ProjectRepo(mockPool)
    const result = await repo.create('user-1', '한글프로젝트')

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    const usedSlug = params[2] as string
    // 영문·숫자가 없으므로 'proj-' 접두사 UUID slug가 사용되어야 한다
    expect(usedSlug).toMatch(/^proj-[0-9a-f]{8}$/)
    expect(result.name).toBe('한글프로젝트')
  })

  it('options.slug를 명시하면 toSlug를 거치지 않고 그대로 사용된다', async () => {
    const row = makeProjectRow({ name: 'My App', slug: 'custom-slug' })
    mockQuery.mockResolvedValueOnce({ rows: [row] })

    const repo = new ProjectRepo(mockPool)
    const result = await repo.create('user-1', 'My App', { slug: 'custom-slug' })

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(params[2]).toBe('custom-slug')
    expect(result.slug).toBe('custom-slug')
  })

  it('description/githubOwner/githubRepo/githubBranch 기본값이 올바르게 삽입된다', async () => {
    const row = makeProjectRow()
    mockQuery.mockResolvedValueOnce({ rows: [row] })

    const repo = new ProjectRepo(mockPool)
    await repo.create('user-1', 'Test Project')

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(params[3]).toBeNull()   // description
    expect(params[4]).toBeNull()   // githubOwner
    expect(params[5]).toBeNull()   // githubRepo
    expect(params[6]).toBe('main') // githubBranch 기본값
  })

  it('DB row가 없으면 "Failed to create project" 에러를 throw한다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const repo = new ProjectRepo(mockPool)
    await expect(repo.create('user-1', 'Test')).rejects.toThrow('Failed to create project')
  })

  it('slug 중복(23505) 시 statusCode 409로 throw한다', async () => {
    const dbErr = new DatabaseError('duplicate key value violates unique constraint', 0, 'error')
    dbErr.code = '23505'
    mockQuery.mockRejectedValueOnce(dbErr)

    const repo = new ProjectRepo(mockPool)
    const err = await repo.create('user-1', 'Test').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as { statusCode?: number }).statusCode).toBe(409)
    expect((err as Error).message).toContain('이미 동일한 이름의 프로젝트가 있습니다')
  })

  it('다른 DB 에러는 그대로 re-throw한다', async () => {
    const originalErr = new Error('connection refused')
    mockQuery.mockRejectedValueOnce(originalErr)

    const repo = new ProjectRepo(mockPool)
    await expect(repo.create('user-1', 'Test')).rejects.toThrow('connection refused')
  })

  it('create()에 options 전달 시 description/githubOwner/githubRepo/githubBranch가 INSERT에 반영된다', async () => {
    const row = makeProjectRow({
      name: 'My Repo',
      slug: 'my-repo',
      description: 'A great repo',
      github_owner: 'xzawed',
      github_repo: 'myrepo',
      github_branch: 'develop',
    })
    mockQuery.mockResolvedValueOnce({ rows: [row] })

    const repo = new ProjectRepo(mockPool)
    const result = await repo.create('user-1', 'My Repo', {
      description: 'A great repo',
      githubOwner: 'xzawed',
      githubRepo: 'myrepo',
      githubBranch: 'develop',
    })

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(params[3]).toBe('A great repo')
    expect(params[4]).toBe('xzawed')
    expect(params[5]).toBe('myrepo')
    expect(params[6]).toBe('develop')
    expect(result.description).toBe('A great repo')
    expect(result.githubBranch).toBe('develop')
  })
})

describe('ProjectRepo.updateWorkspace', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('updateWorkspace sets workspace fields and returns updated row', async () => {
    const updated = {
      id: 'proj-1', name: 'my-app', slug: 'my-app',
      workspace_type: 'local', local_path: '/home/user/my-app',
      repo_url: null, branch: 'main',
      workspace_path: '/home/user/my-app', push_strategy: 'push',
      user_id: 'user-1', description: null,
      github_owner: null, github_repo: null, github_branch: 'main',
      created_at: new Date(), updated_at: new Date(),
    }
    mockQuery.mockResolvedValueOnce({ rows: [updated] })

    const repo = new ProjectRepo(mockPool)
    const result = await repo.updateWorkspace('proj-1', {
      workspaceType: 'local',
      localPath: '/home/user/my-app',
      branch: 'main',
      workspacePath: '/home/user/my-app',
      pushStrategy: 'push',
    })

    expect(result).toMatchObject({ workspace_type: 'local', workspace_path: '/home/user/my-app' })
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('UPDATE projects')
    expect(params).toContain('local')
    expect(params).toContain('/home/user/my-app')
  })

  it('updateWorkspace returns null when project not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const repo = new ProjectRepo(mockPool)
    const result = await repo.updateWorkspace('nonexistent', {
      workspaceType: 'none',
    })
    expect(result).toBeNull()
  })

  it('findByIdAndUser includes workspace fields', async () => {
    const row = {
      id: 'proj-1', name: 'my-app', slug: 'my-app',
      workspace_type: 'github', local_path: null,
      repo_url: 'https://github.com/user/repo', branch: 'main',
      workspace_path: '/home/user/.xzawed/workspaces/proj-1',
      push_strategy: 'pr',
      user_id: 'user-1', description: null,
      github_owner: null, github_repo: null, github_branch: 'main',
      created_at: new Date(), updated_at: new Date(),
    }
    mockQuery.mockResolvedValueOnce({ rows: [row] })

    const repo = new ProjectRepo(mockPool)
    const result = await repo.findByIdAndUser('proj-1', 'user-1')
    expect(result?.workspace_type).toBe('github')
    expect(result?.workspace_path).toBe('/home/user/.xzawed/workspaces/proj-1')
  })
})
