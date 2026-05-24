import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { ProjectRepo } from '../project.repo.js'

const mockQuery = vi.fn()
const mockPool = { query: mockQuery } as unknown as Pool

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
