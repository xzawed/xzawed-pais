import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Pool } from 'pg'
import type { FastifyBaseLogger } from 'fastify'
import type { Message } from '@xzawed/shared'
import type { StreamProducer } from '../../streams/producer.js'
import type { Project } from '../../projects/project.repo.js'

const { mockFindByIdAndUser } = vi.hoisted(() => {
  const mockFindByIdAndUser = vi.fn()
  return { mockFindByIdAndUser }
})

vi.mock('../../projects/project.repo.js', () => ({
  ProjectRepo: vi.fn().mockImplementation(() => ({
    findByIdAndUser: mockFindByIdAndUser,
  })),
}))

import { publishTaskToManager } from '../sessions.route.js'

const SID = 'sess-pub-test'
const SNAPSHOT: Message[] = []

function makeProducer() {
  return { publish: vi.fn().mockResolvedValue(undefined) } as unknown as StreamProducer
}

function makeLog() {
  return { warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger
}

function makeProject(workspace_path: string | null = '/ws'): Project {
  return {
    id: 'proj-1', userId: 'u1', name: 'test', slug: 'test',
    description: null, githubOwner: null, githubRepo: null, githubBranch: 'main',
    createdAt: new Date(), updatedAt: new Date(),
    workspace_path,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.WORKSPACE_ROOT
})

describe('publishTaskToManager — projectId null', () => {
  it('WORKSPACE_ROOT 미설정 시 기본 /workspace로 userContext 전달 (register_project 호출 방지)', async () => {
    const producer = makeProducer()
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: null }, undefined, makeLog())
    expect(producer.publish).toHaveBeenCalledOnce()
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { userId: string; projectId: string; workspaceRoot: string } } }
    expect(msg.payload.userContext).toEqual({ userId: 'u1', projectId: 'default', workspaceRoot: '/workspace' })
  })

  it('WORKSPACE_ROOT 설정 시 해당 경로로 userContext 전달', async () => {
    process.env.WORKSPACE_ROOT = '/custom/ws'
    const producer = makeProducer()
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: null }, undefined, makeLog())
    expect(producer.publish).toHaveBeenCalledOnce()
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { workspaceRoot: string } } }
    expect(msg.payload.userContext.workspaceRoot).toBe('/custom/ws')
  })
})

describe('publishTaskToManager — 파일시스템 루트 차단', () => {
  it('workspaceRoot가 파일시스템 루트이면 throw', async () => {
    const { parse } = await import('node:path')
    const fsRoot = parse(process.cwd()).root
    process.env.WORKSPACE_ROOT = fsRoot
    const producer = makeProducer()
    await expect(
      publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: 'proj-1' }, undefined, makeLog())
    ).rejects.toThrow('WORKSPACE_ROOT must not be filesystem root')
    expect(producer.publish).not.toHaveBeenCalled()
  })
})

describe('publishTaskToManager — projectId 있음, pool 없음', () => {
  it('WORKSPACE_ROOT 환경변수를 workspaceRoot로 사용', async () => {
    process.env.WORKSPACE_ROOT = '/env-root'
    const producer = makeProducer()
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: 'proj-1' }, undefined, makeLog())
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { workspaceRoot: string; userId: string; projectId: string } } }
    expect(msg.payload.userContext?.workspaceRoot).toBe('/env-root')
    expect(msg.payload.userContext?.userId).toBe('u1')
    expect(msg.payload.userContext?.projectId).toBe('proj-1')
  })
})

describe('publishTaskToManager — projectId 있음, pool 있음', () => {
  it('ProjectRepo.findByIdAndUser 호출하여 workspace_path를 workspaceRoot로 사용', async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(makeProject('/custom/workspace'))
    const producer = makeProducer()
    const pool = {} as Pool
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: 'proj-1' }, undefined, makeLog(), pool)
    expect(mockFindByIdAndUser).toHaveBeenCalledWith('proj-1', 'u1')
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { workspaceRoot: string } } }
    expect(msg.payload.userContext?.workspaceRoot).toBe('/custom/workspace')
  })

  it('project 미발견 시 envFallback 사용', async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(undefined)
    process.env.WORKSPACE_ROOT = '/fallback-root'
    const producer = makeProducer()
    const pool = {} as Pool
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: 'proj-1' }, undefined, makeLog(), pool)
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { workspaceRoot: string } } }
    expect(msg.payload.userContext?.workspaceRoot).toBe('/fallback-root')
  })
})
