import { describe, it, expect, vi } from 'vitest'
import { buildDefectBrief, makeEscalationBrief, type EscalationInfo } from './decision-brief.js'
import { handleWpDispatchSignal } from './worker.js'
import { buildWorkerConsumerDeps } from './supervisor.js'

/**
 * **검증 실패 사유가 사람에게 도달한다**(S7.1 / 결함 F5 · 수용 기준 L2-6).
 *
 * 이전에는 `publishVerificationFailed` 가 사유를 `manager:events:{workflowId}` 로만 발행했다.
 * 그 스트림은 **소비자가 0** 이고 per-workflow 라 고정 이름 소비자가 붙을 수도 없다 — 사유가
 * 사실상 소멸했다. 사람이 실제로 읽는 것은 lease 상한 초과 시 만들어지는 `defect_brief` 인데,
 * 그것은 "N회 재시도 모두 검증 실패"라는 **일반 문구뿐**이라 무엇이 왜 실패했는지가 없었다.
 *
 * 이 파일은 세 지점을 고정한다: 순수 빌더 · 에스컬레이션 배선 · 워커 배선.
 * **순수 함수만 테스트하면 호출을 빼먹어도 초록**이라(S6.2 의 "함수는 있는데 호출자 0곳")
 * 배선 테스트를 따로 둔다.
 */

const info = (over: Partial<EscalationInfo> = {}): EscalationInfo => ({
  workflowId: 'wf1', wpId: 'wp-a', attempt: 2, stepN: 3, ...over,
})

describe('buildDefectBrief — 사유를 브리프 본문에 싣는다', () => {
  it('사유가 있으면 attempt 별로 본문에 나열한다', () => {
    const b = buildDefectBrief(info({
      failures: [
        { attempt: 0, reason: 'run_tests: success=false failed=3' },
        { attempt: 1, reason: 'security: 결정론 SAST 1건 차단(high:static)' },
      ],
    }))
    expect(b.context?.expectedVsActual).toContain('run_tests: success=false failed=3')
    expect(b.context?.expectedVsActual).toContain('security: 결정론 SAST 1건 차단(high:static)')
    expect(b.context?.expectedVsActual).toContain('attempt 0')
    expect(b.context?.expectedVsActual).toContain('attempt 1')
  })

  it('사유마다 evidenceRef 를 남긴다', () => {
    const b = buildDefectBrief(info({ failures: [{ attempt: 1, reason: 'x' }] }))
    expect(b.context?.evidenceRefs).toContain('wp.verification.failed@attempt=1')
  })

  /** 회귀 0 — 사유가 없으면 이전과 같은 문구여야 한다(미배선·조회 실패 경로). */
  it('사유가 없으면 기존 브리프와 같다', () => {
    const before = buildDefectBrief(info())
    expect(before.context?.expectedVsActual).toContain('계약 사슬상 Task')
    expect(before.context?.expectedVsActual).not.toContain('검증이 거부한 사유')
    expect(before.context?.evidenceRefs).toEqual(['wp.escalated@wf1/wp-a', 'attempt=3'])
  })

  it('빈 배열도 사유 없음과 같게 다룬다', () => {
    expect(buildDefectBrief(info({ failures: [] }))).toEqual(buildDefectBrief(info()))
  })

  /** 에이전트 오류 전문이 사람이 읽을 브리프를 잠식하지 않게 한 줄을 자른다. */
  it('긴 사유는 잘라 싣는다', () => {
    const b = buildDefectBrief(info({ failures: [{ attempt: 0, reason: 'E'.repeat(1000) }] }))
    expect(b.context?.expectedVsActual!.length).toBeLessThan(700)
  })
})

describe('makeEscalationBrief — 배선(사유를 조회해 얹는다)', () => {
  const store = () => ({ createRequest: vi.fn().mockResolvedValue({ eventId: 'e1' }) })

  it('failureStore 를 조회해 브리프에 싣는다', async () => {
    const s = store()
    const failureStore = { recentForWp: vi.fn().mockResolvedValue([{ attempt: 0, reason: 'build_project: success=false' }]) }
    await makeEscalationBrief(s, { failureStore })(info())
    expect(failureStore.recentForWp).toHaveBeenCalledWith('wf1', 'wp-a')
    expect(s.createRequest.mock.calls[0]![0].context.expectedVsActual).toContain('build_project: success=false')
  })

  /** 사유 없는 브리프가 브리프 없는 것보다 낫다 — 조회 실패가 사람 도달 자체를 없애면 안 된다. */
  it('조회가 throw 해도 브리프는 발행된다(사유 없이)', async () => {
    const s = store()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failureStore = { recentForWp: vi.fn().mockRejectedValue(new Error('db down')) }
    await makeEscalationBrief(s, { failureStore })(info())
    expect(s.createRequest).toHaveBeenCalledTimes(1)
    expect(s.createRequest.mock.calls[0]![0].context.expectedVsActual).toContain('계약 사슬상 Task')
  })

  it('failureStore 미주입이면 이전과 같은 브리프다(회귀 0)', async () => {
    const s = store()
    await makeEscalationBrief(s)(info())
    expect(s.createRequest.mock.calls[0]![0].context.expectedVsActual).not.toContain('검증이 거부한 사유')
  })
})

describe('워커 배선 — 검증 실패 시 사유를 영속한다', () => {
  const wp = { id: 'a', storyId: 's1', owningRole: 'tester', oracleRef: null, acceptanceCriteria: ['ac'], dependencies: [], attributionCounters: {}, status: 'DRAFTED' }
  const sig = () => ({
    envelope: { workflowId: 'wf1', eventId: 'e', correlationId: 'wf1', causationId: null, stepId: 's', attemptId: 1, occurredAt: 0, idempotencyKey: 'k' },
    type: 'wp.dispatch_signal', payload: { wpId: 'a', attempt: 1 },
  }) as never

  const baseDeps = (failureStore?: unknown) => ({
    // 프로덕션 워커는 verifyEnabled 경로에서 `latestStates` 로 stale 신호를 거른다(S6.2) — 목도 같은 모양이어야 한다.
    repo: {
      getGraph: vi.fn().mockResolvedValue({ workPackages: [wp], eventId: null, version: 1 }),
      latestStates: vi.fn().mockResolvedValue(new Map()),
    },
    publish: vi.fn().mockResolvedValue(undefined),
    handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: false, failed: 3, passed: 0 }) } },
    verifyEnabled: true,
    ...(failureStore ? { failureStore } : {}),
  }) as never

  it('실패 사유를 failureStore 에 기록한다', async () => {
    const failureStore = { record: vi.fn().mockResolvedValue(undefined) }
    const out = await handleWpDispatchSignal(sig(), baseDeps(failureStore))
    expect(out.status).toBe('verification_failed')
    expect(failureStore.record).toHaveBeenCalledTimes(1)
    const rec = failureStore.record.mock.calls[0]![0] as { workflowId: string; wpId: string; attempt: number; reason: string }
    expect(rec).toMatchObject({ workflowId: 'wf1', wpId: 'a', attempt: 1 })
    expect(rec.reason).toContain('run_tests')
  })

  /** 영속 실패가 reclaim 을 막으면 안 된다 — 완료 부재가 load-bearing 신호다. */
  it('영속이 throw 해도 verification_failed 를 그대로 반환한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failureStore = { record: vi.fn().mockRejectedValue(new Error('db down')) }
    const out = await handleWpDispatchSignal(sig(), baseDeps(failureStore))
    expect(out.status).toBe('verification_failed')
  })

  it('미주입이면 기록을 시도하지 않고 기존 동작 그대로다', async () => {
    const d = baseDeps()
    const out = await handleWpDispatchSignal(sig(), d)
    expect(out.status).toBe('verification_failed')
    // 완료 미발행 + verification.failed 만 발행되는 기존 계약 유지
    expect((d as unknown as { publish: { mock: { calls: unknown[] } } }).publish.mock.calls).toHaveLength(1)
  })

  it('검증을 통과하면 사유를 기록하지 않는다', async () => {
    const failureStore = { record: vi.fn().mockResolvedValue(undefined) }
    const d = {
      ...baseDeps(failureStore) as unknown as Record<string, unknown>,
      handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: true, failed: 0, passed: 5 }) } },
    } as never
    const out = await handleWpDispatchSignal(sig(), d)
    expect(out.status).toBe('completed')
    expect(failureStore.record).not.toHaveBeenCalled()
  })
})

/**
 * **릴레이 배선 — 이 슬라이스가 실제로 죽었던 자리다.**
 *
 * `failureStore` 는 `SupervisorDeps` 에도, `buildWorkerConsumerDeps` 의 `Pick<>` 에도, 그 내부
 * 조건부 스프레드에도 전부 있었는데 **`createSupervisor` 가 넘기는 인자 객체 한 곳에서만 빠져**
 * 워커가 영원히 받지 못했다. 인자가 전부 옵셔널이라 tsc 가 침묵했고, 유닛은 빌더 함수와 워커
 * 핸들러를 각각 **직접** 호출해 테스트하므로 1491건이 전부 초록이었다. Grok 반증이 잡았다.
 *
 * 고친 방식은 호출부의 키 나열을 없애 `deps` 를 통째로 넘기는 것이다 — 목록이 사라져 `Pick<>` 이
 * 유일한 계약이 되고, Pick 에서 키를 빼면 함수 본문의 `deps.X` 가 tsc 에러가 된다.
 * 아래 테스트는 **프로덕션과 같은 모양**(전체 deps 스프레드)으로 조립해 통과를 고정한다.
 */
describe('buildWorkerConsumerDeps — 전체 deps 스프레드가 failureStore 를 나른다', () => {
  const cfg = { wpVerify: true, visibilityMs: 1000, maxAttempts: 3, sweepMs: 1000, taskWorker: true } as never

  /** `createSupervisor` 가 실제로 갖는 모양 — 워커가 안 읽는 키까지 포함한 SupervisorDeps 전체. */
  const supervisorDeps = (over: Record<string, unknown> = {}) => ({
    repo: {} as never, dispatchStore: {} as never, leaseStore: {} as never, publish: vi.fn(),
    handlers: { develop_code: { execute: vi.fn() } },
    ...over,
  })

  it('failureStore 가 워커 deps 까지 도달한다', () => {
    const failureStore = { record: vi.fn(), recentForWp: vi.fn() }
    const d = supervisorDeps({ failureStore })
    const worker = buildWorkerConsumerDeps({ ...d, handlers: d.handlers } as never, cfg)
    expect(worker.failureStore, 'createSupervisor 호출부에서 failureStore 가 유실됐다').toBe(failureStore)
  })

  it('미주입이면 키가 생기지 않는다(exactOptionalPropertyTypes)', () => {
    const d = supervisorDeps()
    const worker = buildWorkerConsumerDeps({ ...d, handlers: d.handlers } as never, cfg)
    expect('failureStore' in worker).toBe(false)
  })

  /** 같은 사고가 다른 의존에서 재발하지 않도록 릴레이 전체를 한 번에 건다. */
  it('다른 선택 의존들도 같은 경로로 도달한다(릴레이 회귀 잠금)', () => {
    const releaseStore = { recordEvidence: vi.fn() }
    const decisionStore = { createRequest: vi.fn() }
    const d = supervisorDeps({ releaseStore, decisionStore, failureStore: { record: vi.fn(), recentForWp: vi.fn() } })
    const worker = buildWorkerConsumerDeps({ ...d, handlers: d.handlers } as never, cfg)
    expect(worker.releaseStore).toBe(releaseStore)
    expect(worker.decisionStore).toBe(decisionStore)
    expect(worker.failureStore).toBeDefined()
  })
})
