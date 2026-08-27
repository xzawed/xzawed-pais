import { describe, it, expect, vi } from 'vitest'
import { maybeRequestGoldenSignoff, handleWpDispatchSignal } from './worker.js'
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

/**
 * 회귀 봉인 — golden 사인오프는 **`MANAGER_WP_VERIFY` 를 전제하지 않는다.**
 *
 * 위 케이스들은 `maybeRequestGoldenSignoff` 를 직접 부르므로 워커 경로의 조건을 보지 않는다.
 * 실제 경로는 `handleWpDispatchSignal` → `runVerifyGate`(verifyEnabled false 면 **판정 없이 null**)
 * → 다음 줄에서 이 함수를 무조건 호출이다. 코드 주석 8곳이 오래 "verdict.ok 후"라고 적고 있었고
 * advisory 쪽에서는 그 오해가 운영자에게 나가는 기동 경고까지 만들었다(#645).
 *
 * 이 테스트는 **워커 경로 전체를 통과시켜** 그 사실을 고정한다. N7 은 그대로다 — 이 경로는
 * 사인오프 *요청*만 만들고 freeze 는 사람 승인으로만 일어난다.
 */
describe('golden 사인오프는 검증 게이트를 전제하지 않는다 (회귀 봉인)', () => {
  const wp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'] }
  const msg = { envelope: { workflowId: 'wf-1' }, payload: { wpId: 'wp-1', attempt: 0 } }

  function workerDeps(over: Record<string, unknown> = {}): WorkerDeps {
    return {
      repo: {
        getGraph: vi.fn().mockResolvedValue({ workPackages: [wp], userContext: undefined }),
        latestStates: vi.fn().mockResolvedValue(new Map()),
      },
      handlers: { develop_code: { execute: vi.fn().mockResolvedValue({ artifacts: ['src/x.ts'] }) } },
      publish: vi.fn().mockResolvedValue(undefined),
      verifyEnabled: false,
      goldenSignoffEnabled: true,
      oracleStore: { unfrozenGoldenCount: vi.fn().mockResolvedValue(2) },
      decisionStore: { createRequest: vi.fn().mockResolvedValue(undefined) },
      ...over,
    } as unknown as WorkerDeps
  }

  it('verifyEnabled=false 여도 워커 경로에서 golden_diff 가 발행된다', async () => {
    const d = workerDeps()
    const out = await handleWpDispatchSignal(msg as never, d)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
    expect(createReq(d)).toHaveBeenCalledTimes(1)
  })

  it('flag off 면 verifyEnabled 와 무관하게 미발행 — 전제는 goldenSignoffEnabled 다', async () => {
    const d = workerDeps({ goldenSignoffEnabled: false })
    await handleWpDispatchSignal(msg as never, d)
    expect(createReq(d)).not.toHaveBeenCalled()
  })
})
