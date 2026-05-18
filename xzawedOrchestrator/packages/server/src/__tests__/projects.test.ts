import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool, QueryResult } from 'pg'
import { ProjectRepo } from '../projects/project.repo.js'

function makePool(rows: Record<string, unknown>[]) {
  const querySpy = vi.fn().mockResolvedValue({ rows } as QueryResult)
  return { pool: { query: querySpy } as unknown as Pool, querySpy }
}

const BASE_ROW = {
  id: 'proj-1',
  user_id: 'user-1',
  name: 'My Project',
  slug: 'my-project',
  description: null,
  github_owner: null,
  github_repo: null,
  github_branch: 'main',
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-01'),
}

describe('ProjectRepo', () => {
  let pool: Pool
  let querySpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const result = makePool([BASE_ROW])
    pool = result.pool
    querySpy = result.querySpy
  })

  it('create는 슬러그를 자동 생성하고 Project를 반환한다', async () => {
    const repo = new ProjectRepo(pool)
    const project = await repo.create('user-1', 'My Project')
    expect(project.id).toBe('proj-1')
    expect(project.userId).toBe('user-1')
    expect(project.name).toBe('My Project')
    expect(project.githubBranch).toBe('main')
  })

  it('findByUser는 Project 배열을 반환한다', async () => {
    const repo = new ProjectRepo(pool)
    const projects = await repo.findByUser('user-1')
    expect(projects).toHaveLength(1)
    expect(projects[0]?.userId).toBe('user-1')
  })

  it('findById는 존재하는 프로젝트를 반환한다', async () => {
    const repo = new ProjectRepo(pool)
    const project = await repo.findById('proj-1')
    expect(project?.id).toBe('proj-1')
  })

  it('findById는 없는 프로젝트에 undefined를 반환한다', async () => {
    const { pool: emptyPool } = makePool([])
    const repo = new ProjectRepo(emptyPool)
    const project = await repo.findById('non-existent')
    expect(project).toBeUndefined()
  })

  it('findByIdAndUser는 id+user_id 모두 일치 시 Project를 반환한다', async () => {
    const repo = new ProjectRepo(pool)
    const project = await repo.findByIdAndUser('proj-1', 'user-1')
    expect(project?.id).toBe('proj-1')
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('user_id'),
      ['proj-1', 'user-1']
    )
  })

  it('findByIdAndUser는 user_id 불일치 시 undefined를 반환한다', async () => {
    const { pool: emptyPool } = makePool([])
    const repo = new ProjectRepo(emptyPool)
    const project = await repo.findByIdAndUser('proj-1', 'other-user')
    expect(project).toBeUndefined()
  })

  it('update는 업데이트된 Project를 반환한다', async () => {
    const repo = new ProjectRepo(pool)
    const project = await repo.update('proj-1', { name: 'Updated' })
    expect(project.id).toBe('proj-1')
  })

  it('update가 row를 반환하지 않으면 에러를 throw한다', async () => {
    const { pool: emptyPool } = makePool([])
    const repo = new ProjectRepo(emptyPool)
    await expect(repo.update('proj-1', { name: 'x' })).rejects.toThrow('Project not found')
  })

  it('delete는 쿼리를 실행한다', async () => {
    const repo = new ProjectRepo(pool)
    await expect(repo.delete('proj-1')).resolves.toBeUndefined()
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['proj-1']
    )
  })
})

describe('toSlug (create 경유 쿼리 인자 검증)', () => {
  it('특수문자를 하이픈으로 변환한다', async () => {
    const { pool, querySpy } = makePool([{ ...BASE_ROW, slug: 'hello-world' }])
    const repo = new ProjectRepo(pool)
    await repo.create('user-1', 'Hello World!')
    const slug = querySpy.mock.calls[0][1][2]
    expect(slug).toBe('hello-world')
  })

  it('선행·후행 하이픈을 제거한다', async () => {
    const { pool, querySpy } = makePool([{ ...BASE_ROW, slug: 'test' }])
    const repo = new ProjectRepo(pool)
    await repo.create('user-1', '  --test--  ')
    const slug = querySpy.mock.calls[0][1][2]
    expect(slug).toBe('test')
  })

  it('60자를 초과하지 않는다', async () => {
    const { pool, querySpy } = makePool([{ ...BASE_ROW, slug: 'a'.repeat(60) }])
    const repo = new ProjectRepo(pool)
    await repo.create('user-1', 'a'.repeat(100))
    const slug: string = querySpy.mock.calls[0][1][2]
    expect(slug.length).toBeLessThanOrEqual(60)
  })
})

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? ''
const hasDb = DATABASE_URL !== ''

describe.skipIf(!hasDb)('projects routes integration', () => {
  it.todo('GET/POST /projects, GET/PATCH/DELETE /projects/:id 전체 흐름 (DB 필요)')
  it.todo('타 사용자 프로젝트 접근 시 404 반환 (정보 누출 방지)')
})
