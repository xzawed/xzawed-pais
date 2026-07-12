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
  ProjectRepo: vi.fn().mockImplementation(function () { return ({
    findByIdAndUser: mockFindByIdAndUser,
  }) }),
}))

import { publishTaskToManager, buildUserContext, shouldDecompose, publishDecomposeToManager } from '../sessions.route.js'

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
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: null }, () => undefined, makeLog())
    expect(producer.publish).toHaveBeenCalledOnce()
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { userId: string; projectId: string; workspaceRoot: string } } }
    expect(msg.payload.userContext).toEqual({ userId: 'u1', projectId: 'default', workspaceRoot: '/workspace' })
  })

  it('WORKSPACE_ROOT 설정 시 해당 경로로 userContext 전달', async () => {
    process.env.WORKSPACE_ROOT = '/custom/ws'
    const producer = makeProducer()
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: null }, () => undefined, makeLog())
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
      publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: 'proj-1' }, () => undefined, makeLog())
    ).rejects.toThrow('WORKSPACE_ROOT must not be filesystem root')
    expect(producer.publish).not.toHaveBeenCalled()
  })
})

describe('publishTaskToManager — projectId 있음, pool 없음', () => {
  it('WORKSPACE_ROOT 환경변수를 workspaceRoot로 사용', async () => {
    process.env.WORKSPACE_ROOT = '/env-root'
    const producer = makeProducer()
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: 'proj-1' }, () => undefined, makeLog())
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { workspaceRoot: string; userId: string; projectId: string } } }
    expect(msg.payload.userContext?.workspaceRoot).toBe('/env-root')
    expect(msg.payload.userContext?.userId).toBe('u1')
    expect(msg.payload.userContext?.projectId).toBe('proj-1')
  })
})

describe('publishTaskToManager — gateMode', () => {
  it('gateMode가 주어지면 task_request payload에 포함한다', async () => {
    const producer = makeProducer()
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: null }, () => undefined, makeLog(), undefined, 'ko', 'auto')
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { gateMode?: string } }
    expect(msg.payload.gateMode).toBe('auto')
  })

  it('gateMode가 없으면 payload에 gateMode 키가 없다', async () => {
    const producer = makeProducer()
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: null }, () => undefined, makeLog())
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: Record<string, unknown> }
    expect('gateMode' in msg.payload).toBe(false)
  })
})

describe('publishTaskToManager — projectId 있음, pool 있음', () => {
  it('ProjectRepo.findByIdAndUser 호출하여 workspace_path를 workspaceRoot로 사용', async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(makeProject('/custom/workspace'))
    const producer = makeProducer()
    const pool = {} as Pool
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: 'proj-1' }, () => undefined, makeLog(), pool)
    expect(mockFindByIdAndUser).toHaveBeenCalledWith('proj-1', 'u1')
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { workspaceRoot: string } } }
    expect(msg.payload.userContext?.workspaceRoot).toBe('/custom/workspace')
  })

  it('project 미발견 시 envFallback 사용', async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(undefined)
    process.env.WORKSPACE_ROOT = '/fallback-root'
    const producer = makeProducer()
    const pool = {} as Pool
    await publishTaskToManager(producer, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: 'proj-1' }, () => undefined, makeLog(), pool)
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { payload: { userContext: { workspaceRoot: string } } }
    expect(msg.payload.userContext?.workspaceRoot).toBe('/fallback-root')
  })
})

describe('buildUserContext', () => {
  it('projectId null → default·env workspaceRoot', async () => {
    process.env.WORKSPACE_ROOT = '/ws-a'
    const uc = await buildUserContext({ userId: 'u1', projectId: null })
    expect(uc).toEqual({ userId: 'u1', projectId: 'default', workspaceRoot: '/ws-a' })
  })
  it('projectId 있음·pool 있음 → project.workspace_path', async () => {
    mockFindByIdAndUser.mockResolvedValueOnce(makeProject('/custom/ws'))
    const uc = await buildUserContext({ userId: 'u1', projectId: 'proj-1' }, {} as Pool)
    expect(mockFindByIdAndUser).toHaveBeenCalledWith('proj-1', 'u1')
    expect(uc.workspaceRoot).toBe('/custom/ws')
  })
  it('workspaceRoot가 fs 루트면 throw', async () => {
    const { parse } = await import('node:path')
    process.env.WORKSPACE_ROOT = parse(process.cwd()).root
    await expect(buildUserContext({ userId: 'u1', projectId: 'proj-1' })).rejects.toThrow('WORKSPACE_ROOT must not be filesystem root')
  })
})

describe('shouldDecompose', () => {
  it('build + enabled → true', () => { expect(shouldDecompose('build', true)).toBe(true) })
  it('build + disabled → false', () => { expect(shouldDecompose('build', false)).toBe(false) })
  it('chat/undefined → false', () => {
    expect(shouldDecompose('chat', true)).toBe(false)
    expect(shouldDecompose(undefined, true)).toBe(false)
  })
})

describe('publishDecomposeToManager', () => {
  const UC = { userId: 'u1', projectId: 'default', workspaceRoot: '/ws' }
  it('decompose_request를 intent·userContext로 발행', async () => {
    const producer = makeProducer()
    await publishDecomposeToManager(producer, SID, 'build a todo app', UC, () => undefined, makeLog())
    expect(producer.publish).toHaveBeenCalledOnce()
    const msg = (producer.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as { type: string; payload: { intent: string; userContext: unknown } }
    expect(msg.type).toBe('decompose_request')
    expect(msg.payload.intent).toBe('build a todo app')
    expect(msg.payload.userContext).toEqual(UC)
  })
  it('publish 실패 시 throw하지 않고 false 반환 + log.warn(드롭을 done으로 위장 방지)', async () => {
    const producer = { publish: vi.fn().mockRejectedValue(new Error('redis down')) } as unknown as StreamProducer
    const log = makeLog()
    await expect(publishDecomposeToManager(producer, SID, 'x', UC, () => undefined, log)).resolves.toBe(false)
    expect((log.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })
  it('publish 성공 시 true 반환', async () => {
    await expect(publishDecomposeToManager(makeProducer(), SID, 'x', UC, () => undefined, makeLog())).resolves.toBe(true)
  })
})

// publishTaskToManager(chat 경로)는 러너 스트리밍 후 best-effort 전달이라 실패해도 비차단
// (반환값 없음). Manager 미가용이 chat 턴 완료를 막지 않는 복원력 계약.
describe('publishTaskToManager — 발행 실패 비차단(chat 복원력)', () => {
  it('publish 실패 시 throw하지 않고 log.warn(턴은 done으로 완료·아래 route 통합 테스트가 검증)', async () => {
    const failing = { publish: vi.fn().mockRejectedValue(new Error('redis down')) } as unknown as StreamProducer
    const log = makeLog()
    await expect(
      publishTaskToManager(failing, SID, 'intent', SNAPSHOT, { userId: 'u1', projectId: null }, () => undefined, log),
    ).resolves.toBeUndefined()
    expect((log.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })
})
