import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import type { FastifyReply } from 'fastify'
import { assertProjectOwner } from '../ownership.js'
import { ProjectRepo } from '../../projects/project.repo.js'

vi.mock('../../projects/project.repo.js', () => ({
  ProjectRepo: vi.fn(),
}))

const MOCK_PROJECT = {
  id: 'proj-1',
  userId: 'user-1',
  name: 'Test Project',
  slug: 'test-project',
  description: null,
  githubOwner: null,
  githubRepo: null,
  githubBranch: 'main',
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeReply(): FastifyReply {
  const send = vi.fn().mockResolvedValue(undefined)
  const status = vi.fn().mockReturnValue({ send })
  return { status } as unknown as FastifyReply
}

function makePool(): Pool {
  return {} as unknown as Pool
}

describe('assertProjectOwner', () => {
  let mockFindByIdAndUser: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFindByIdAndUser = vi.fn()
    vi.mocked(ProjectRepo).mockImplementation(() => ({
      findByIdAndUser: mockFindByIdAndUser,
    }) as unknown as ProjectRepo)
  })

  it('소유자가 일치하는 프로젝트를 반환한다', async () => {
    mockFindByIdAndUser.mockResolvedValue(MOCK_PROJECT)
    const reply = makeReply()
    const result = await assertProjectOwner('user-1', 'proj-1', makePool(), reply)
    expect(result).toEqual(MOCK_PROJECT)
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('프로젝트 미존재 시 404를 응답하고 false를 반환한다', async () => {
    mockFindByIdAndUser.mockResolvedValue(undefined)
    const reply = makeReply()
    const result = await assertProjectOwner('user-1', 'proj-nonexistent', makePool(), reply)
    expect(result).toBe(false)
    expect(reply.status).toHaveBeenCalledWith(404)
  })

  it('타 사용자 소유 프로젝트 접근 시 false를 반환한다', async () => {
    mockFindByIdAndUser.mockResolvedValue(undefined)
    const reply = makeReply()
    const result = await assertProjectOwner('other-user', 'proj-1', makePool(), reply)
    expect(result).toBe(false)
    expect(reply.status).toHaveBeenCalledWith(404)
  })

  it('DB 오류 시 예외를 전파한다', async () => {
    mockFindByIdAndUser.mockRejectedValue(new Error('DB connection failed'))
    const reply = makeReply()
    await expect(
      assertProjectOwner('user-1', 'proj-1', makePool(), reply)
    ).rejects.toThrow('DB connection failed')
  })
})
