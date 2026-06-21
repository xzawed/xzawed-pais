import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { handleDecomposeRequest } from './trigger.js'
import type { ProduceDeps } from './producer.js'
import type { RiskClassifyDeps } from './risk-producer.js'
import { produceRiskClassification } from './risk-producer.js'

vi.mock('./risk-producer.js', () => ({
  produceRiskClassification: vi.fn().mockResolvedValue({ classified: false }),
}))

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    await handleDecomposeRequest('sess-uc', 'build it', mockDecompose(emitPublish), { publish: producerPublish }, cleanup, uc, undefined, ensureWs)

    expect(ensureWs).toHaveBeenCalledWith(uc)
    const emitMsg = emitPublish.mock.calls[0]![1]
    expect(emitMsg.payload.userContext).toEqual(uc)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('userContext 미전달 시 ensureWs 미호출 + payload에 userContext 키 없음', async () => {
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const ensureWs = vi.fn().mockResolvedValue(undefined)
    await handleDecomposeRequest('sess-no-uc', 'build it', mockDecompose(emitPublish), { publish: vi.fn().mockResolvedValue('1-0') }, vi.fn().mockResolvedValue(undefined), undefined, undefined, ensureWs)
    expect(ensureWs).not.toHaveBeenCalled()
    expect(emitPublish.mock.calls[0]![1].payload).not.toHaveProperty('userContext')
  })

  it('ensureWs 실패 시 error 발행(M8 무음 금지) + cleanup 보장(finally) + 분해 미진행', async () => {
    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const producerPublish = vi.fn().mockResolvedValue('1-0')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const ensureWs = vi.fn().mockRejectedValue(new Error('WORKSPACE_ROOT must not be filesystem root'))
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/' }
    await expect(
      handleDecomposeRequest('sess-bad-ws', 'x', mockDecompose(emitPublish), { publish: producerPublish }, cleanup, uc, undefined, ensureWs),
    ).rejects.toThrow(/filesystem root/)
    expect(emitPublish).not.toHaveBeenCalled()
    // task_request 경로 대칭 — 요청자가 무한 대기하지 않도록 error 메시지를 발행
    const errMsg = producerPublish.mock.calls[0]![0]
    expect(errMsg.type).toBe('error')
    expect(errMsg.sessionId).toBe('sess-bad-ws')
    expect(errMsg.payload.content).toContain('filesystem root')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('error 발행 자체가 실패해도 원 오류를 보존해 재던진다', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const badProducer = { publish: vi.fn().mockRejectedValue(new Error('redis down')) }
    const ensureWs = vi.fn().mockRejectedValue(new Error('original failure'))
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/' }
    await expect(
      handleDecomposeRequest('sess-double-fail', 'x', mockDecompose(vi.fn()), badProducer, cleanup, uc, undefined, ensureWs),
    ).rejects.toThrow(/original failure/)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('리스크 분류가 거부(reject)해도 task_complete·cleanup은 반드시 실행된다(구조적 best-effort 격리)', async () => {
    // Fix 2: produceRiskClassification이 reject하더라도 분해 경로가 살아남음을 검증.
    // .catch(() => undefined) 가드가 없으면 reject가 M8 catch로 bubble → error 발행·task_complete 미발행.
    vi.mocked(produceRiskClassification).mockRejectedValueOnce(new Error('risk boom'))

    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const producerPublish = vi.fn().mockResolvedValue('1-0')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const riskClassify: RiskClassifyDeps = {
      claude: { messages: { create: vi.fn() } } as unknown as RiskClassifyDeps['claude'],
      model: 'm',
      repo: { upsert: vi.fn().mockResolvedValue(undefined) },
    }
    const uc = { userId: 'u', projectId: 'p', workspaceRoot: '/ws' }

    await handleDecomposeRequest(
      'sess-risk-reject', 'intent', mockDecompose(emitPublish), { publish: producerPublish }, cleanup,
      uc as never,
      riskClassify,
    )
    // 리스크 분류가 reject했음에도 분해 경로는 그대로 완료
    expect(producerPublish).toHaveBeenCalledWith(expect.objectContaining({ type: 'task_complete' }))
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('riskClassify 주입 시 produceDecomposition 후 best-effort 호출 + task_complete·cleanup 유지(happy path)', async () => {
    // vi.mock('./risk-producer.js') 호이스팅으로 모듈 교체 — 정적 import로 spy 접근(Fix 3).
    vi.mocked(produceRiskClassification).mockResolvedValueOnce({ classified: true, risk: 'LOW' })

    const emitPublish = vi.fn().mockResolvedValue('1-0')
    const producerPublish = vi.fn().mockResolvedValue('1-0')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const riskClassify: RiskClassifyDeps = {
      claude: { messages: { create: vi.fn() } } as unknown as RiskClassifyDeps['claude'],
      model: 'm',
      repo: { upsert: vi.fn().mockResolvedValue(undefined) },
    }
    const uc = { userId: 'u', projectId: 'p', workspaceRoot: '/ws' }

    await handleDecomposeRequest(
      'sess-risk', 'intent', mockDecompose(emitPublish), { publish: producerPublish }, cleanup,
      uc as never,
      riskClassify,
    )
    // 1) riskClassify가 있으면 produceRiskClassification이 실제로 호출됨(인자 순서 단언)
    expect(vi.mocked(produceRiskClassification)).toHaveBeenCalledWith('intent', 'sess-risk', riskClassify, expect.objectContaining({ projectId: 'p' }))
    // 2) decompose·publish·cleanup 경로는 risk 호출에 무관하게 유지
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(producerPublish).toHaveBeenCalledWith(expect.objectContaining({ type: 'task_complete' }))
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
