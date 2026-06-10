import { describe, it, expect, vi } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { handleDecomposeRequest } from './trigger.js'
import type { ProduceDeps } from './producer.js'

function mockDecompose(publish: ProduceDeps['publish']): ProduceDeps {
  const claude: ClaudeLike = {
    messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"workPackages":[{"ref":"a","storyId":"s","owningRole":"developer","acceptanceCriteria":["x"],"dependsOn":[]}]}' }] }) },
  }
  return { claude, model: 'm', publish, now: () => 1 }
}

function stagedDecompose(publish: ProduceDeps['publish'], ...texts: string[]): ProduceDeps {
  const create = vi.fn()
  for (const t of texts) create.mockResolvedValueOnce({ content: [{ type: 'text', text: t }] })
  return { claude: { messages: { create } } as ClaudeLike, model: 'm', publish, now: () => 1, repairMax: 2 }
}

describe('handleDecomposeRequest', () => {
  it('분해 발행 + task_complete 발행 + cleanup 호출', async () => {
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const producerPublish = vi.fn().mockResolvedValue('1-0')
    const cleanup = vi.fn().mockResolvedValue(undefined)

    await handleDecomposeRequest('sess-1', 'build it', mockDecompose(emitPublish), { publish: producerPublish }, cleanup)

    expect(emitPublish).toHaveBeenCalledTimes(1)
    expect(producerPublish).toHaveBeenCalledTimes(1)
    const completeMsg = producerPublish.mock.calls[0]![0]
    expect(completeMsg.type).toBe('task_complete')
    expect(completeMsg.sessionId).toBe('sess-1')
    expect(completeMsg.payload.content).toContain('1')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('생산 실패해도 cleanup은 보장(finally)', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const badProducer = { publish: vi.fn().mockRejectedValue(new Error('publish fail')) }
    const failingDecompose = mockDecompose(vi.fn().mockRejectedValue(new Error('emit fail')))
    await expect(
      handleDecomposeRequest('sess-2', 'x', failingDecompose, badProducer, cleanup),
    ).rejects.toThrow()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('userContext 전달 시 ensureWs 호출 후 emitted payload에 포함(P4a-2)', async () => {
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const producerPublish = vi.fn().mockResolvedValue('1-0')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const ensureWs = vi.fn().mockResolvedValue(undefined)
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1' }

    await handleDecomposeRequest('sess-uc', 'build it', mockDecompose(emitPublish), { publish: producerPublish }, cleanup, uc, ensureWs)

    expect(ensureWs).toHaveBeenCalledWith(uc)
    const emitMsg = emitPublish.mock.calls[0]![1]
    expect(emitMsg.payload.userContext).toEqual(uc)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('userContext 미전달 시 ensureWs 미호출 + payload에 userContext 키 없음', async () => {
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const ensureWs = vi.fn().mockResolvedValue(undefined)
    await handleDecomposeRequest('sess-no-uc', 'build it', mockDecompose(emitPublish), { publish: vi.fn().mockResolvedValue('1-0') }, vi.fn().mockResolvedValue(undefined), undefined, ensureWs)
    expect(ensureWs).not.toHaveBeenCalled()
    expect(emitPublish.mock.calls[0]![1].payload).not.toHaveProperty('userContext')
  })

  it('ensureWs 실패 시에도 cleanup 보장(finally) + 분해 미진행', async () => {
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const ensureWs = vi.fn().mockRejectedValue(new Error('WORKSPACE_ROOT must not be filesystem root'))
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/' }
    await expect(
      handleDecomposeRequest('sess-bad-ws', 'x', mockDecompose(emitPublish), { publish: vi.fn() }, cleanup, uc, ensureWs),
    ).rejects.toThrow(/filesystem root/)
    expect(emitPublish).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('수렴 실패 시 에스컬레이션 메시지 task_complete', async () => {
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const producerPublish = vi.fn().mockResolvedValue('1-0')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const decompose = stagedDecompose(
      emitPublish,
      '{"epics":[{"epicRef":"e1","title":"T"}]}',
      '{"stories":[{"storyId":"s1","epicRef":"e1","title":"T","deliverableIds":["d1"],"acceptanceCriteria":["x"]}]}',
      '{"deliverables":["d1","d2"]}',
      'garbage',
      'garbage',
    )

    await handleDecomposeRequest('sess-3', 'build', decompose, { publish: producerPublish }, cleanup)

    const completeMsg = producerPublish.mock.calls[0]![0]
    expect(completeMsg.type).toBe('task_complete')
    expect(completeMsg.payload.content).toContain('에스컬레이션')
    const emitMsg = emitPublish.mock.calls[0]![1]
    expect(emitMsg.type).toBe('decomposition.inconsistent')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
