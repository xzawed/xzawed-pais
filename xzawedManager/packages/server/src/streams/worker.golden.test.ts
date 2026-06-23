import { describe, it, expect, vi } from 'vitest'
import { maybeRequestGoldenSignoff } from './worker.js'
import type { WorkerDeps } from './worker.js'

function baseDeps(over: Record<string, unknown> = {}): WorkerDeps {
  return {
    repo: {} as never, handlers: {}, publish: vi.fn(),
    goldenSignoffEnabled: true,
    oracleStore: { unfrozenGoldenCount: vi.fn().mockResolvedValue(3) } as never,
    decisionStore: { createRequest: vi.fn().mockResolvedValue(undefined) },
    ...over,
  } as WorkerDeps
}
const createReq = (d: WorkerDeps) => (d.decisionStore as { createRequest: ReturnType<typeof vi.fn> }).createRequest

describe('maybeRequestGoldenSignoff (Slice 1)', () => {
  it('develop_code + unfrozen golden 있으면 golden_diff DecisionRequest 발행(projectId 전파)', async () => {
    const d = baseDeps()
    await maybeRequestGoldenSignoff('develop_code', 'wf', { userId: 'u', projectId: 'p', workspaceRoot: '/ws' }, d)
    expect(createReq(d)).toHaveBeenCalledWith(expect.objectContaining({ type: 'golden_diff', workflowId: 'wf', requestId: 'wf:golden', projectId: 'p' }))
  })
  it('unfrozen golden 0이면 미발행', async () => {
    const d = baseDeps({ oracleStore: { unfrozenGoldenCount: vi.fn().mockResolvedValue(0) } })
    await maybeRequestGoldenSignoff('develop_code', 'wf', undefined, d)
    expect(createReq(d)).not.toHaveBeenCalled()
  })
  it('flag off면 미발행', async () => {
    const d = baseDeps({ goldenSignoffEnabled: false })
    await maybeRequestGoldenSignoff('develop_code', 'wf', undefined, d)
    expect(createReq(d)).not.toHaveBeenCalled()
  })
  it('develop_code 아니면 미발행', async () => {
    const d = baseDeps()
    await maybeRequestGoldenSignoff('run_tests', 'wf', undefined, d)
    expect(createReq(d)).not.toHaveBeenCalled()
  })
  it('decisionStore/oracleStore 미주입이면 미발행(회귀 0)', async () => {
    const d = baseDeps({ decisionStore: undefined })
    await expect(maybeRequestGoldenSignoff('develop_code', 'wf', undefined, d)).resolves.toBeUndefined()
  })
  it('never-throw(createRequest throw 흡수)', async () => {
    const d = baseDeps({ decisionStore: { createRequest: vi.fn().mockRejectedValue(new Error('x')) } })
    await expect(maybeRequestGoldenSignoff('develop_code', 'wf', undefined, d)).resolves.toBeUndefined()
  })
})
