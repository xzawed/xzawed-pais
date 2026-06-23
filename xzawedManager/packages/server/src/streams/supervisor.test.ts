import { describe, it, test, expect, vi } from 'vitest'
import { makeEnvelope } from '@xzawed/agent-streams'
import {
  buildCompletionHandler, CompletionSignalSchema, Supervisor, createSupervisor, shouldWireSupervisor,
  shouldWireOracleConsumer, shouldWireDecisionRoute, shouldWireRiskConsumer, buildWorkerConsumerDeps, shouldWireGoldenSignoff,
  drainHeld, buildDispatchGate, shouldWireDegradedSignoff,
} from './supervisor.js'
import type { LeaseStore } from '../db/lease.repo.js'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { DispatchStore } from '../db/dispatch.repo.js'
import type { DispatchDeps } from './dispatch.js'
import type { Redis } from 'ioredis'

const env = (stepId: string) => makeEnvelope({ correlationId: 'wf-1', workflowId: 'wf-1', stepId, attemptId: 0 }, 1000)
const completionMsg = (wpId: string) =>
  ({ envelope: env('wp.completion'), type: 'wp.completion' as const, payload: { wpId } })

describe('buildCompletionHandler', () => {
  it('handleCompletion(wf, wpId)을 호출한다', async () => {
    const leaseStore = { getLease: vi.fn().mockResolvedValue(null), recordCompletion: vi.fn() }
    const dispatch = { repo: { getGraph: vi.fn(), latestStates: vi.fn() }, store: { recordDispatch: vi.fn() } }
    const handler = buildCompletionHandler({ leaseStore: leaseStore as unknown as LeaseStore, dispatch: dispatch as unknown as DispatchDeps })
    await handler(completionMsg('wp-1'))
    expect(leaseStore.getLease).toHaveBeenCalledWith('wf-1', 'wp-1')
  })
})

describe('CompletionSignalSchema', () => {
  it('완료 신호를 검증한다', () => {
    expect(CompletionSignalSchema.safeParse(completionMsg('wp-1')).success).toBe(true)
    expect(CompletionSignalSchema.safeParse({ type: 'wp.completion', payload: {} }).success).toBe(false)
  })
})

describe('Supervisor', () => {
  it('start/stop이 주입 컴포넌트의 start(channel)/stop을 호출한다', () => {
    const dc = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
    const cc = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
    const ls = { start: vi.fn(), stop: vi.fn() }
    const sup = new Supervisor({ decompositionConsumer: dc, completionConsumer: cc, leaseSweeper: ls }, 'main')
    sup.start()
    expect(dc.start).toHaveBeenCalledWith('main')
    expect(cc.start).toHaveBeenCalledWith('main')
    expect(ls.start).toHaveBeenCalled()
    sup.stop()
    expect(dc.stop).toHaveBeenCalled()
    expect(cc.stop).toHaveBeenCalled()
    expect(ls.stop).toHaveBeenCalled()
  })

  it('consumer.start가 reject해도 start는 throw하지 않는다(기동 실패 catch)', () => {
    const dc = { start: vi.fn().mockRejectedValue(new Error('boom')), stop: vi.fn() }
    const cc = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
    const ls = { start: vi.fn(), stop: vi.fn() }
    const sup = new Supervisor({ decompositionConsumer: dc, completionConsumer: cc, leaseSweeper: ls })
    expect(() => sup.start()).not.toThrow()
  })
})

describe('shouldWireSupervisor', () => {
  it('flag+pool이면 wire', () => expect(shouldWireSupervisor(true, true)).toBe('wire'))
  it('flag만(pool 없음)이면 warn', () => expect(shouldWireSupervisor(true, false)).toBe('warn'))
  it('flag off면 skip(pool 유무 무관)', () => {
    expect(shouldWireSupervisor(false, true)).toBe('skip')
    expect(shouldWireSupervisor(false, false)).toBe('skip')
  })
})

describe('createSupervisor', () => {
  it('소비자별 전용 Redis 연결(makeRedis 2회)을 만들고 Supervisor를 반환한다', () => {
    const makeRedis = vi.fn(() => ({}) as unknown as Redis)
    const sup = createSupervisor(
      makeRedis,
      {
        repo: {} as unknown as TaskGraphRepo,
        dispatchStore: {} as unknown as DispatchStore,
        leaseStore: {} as unknown as LeaseStore,
        publish: vi.fn(),
      },
      { sweepMs: 30_000, visibilityMs: 5000, maxAttempts: 3, oracleDor: false, taskWorker: false },
    )
    expect(makeRedis).toHaveBeenCalledTimes(2)
    expect(sup).toBeInstanceOf(Supervisor)
  })

  it('decisionRouting=true + decisionStore면 결정 소비자를 배선(전용 연결 1개 추가·start/stop 포함)', () => {
    const makeRedis = vi.fn(() => ({}) as unknown as Redis)
    const decisionStore = { createRequest: vi.fn(), getRequest: vi.fn().mockResolvedValue(null) }
    const sup = createSupervisor(
      makeRedis,
      {
        repo: {} as unknown as TaskGraphRepo,
        dispatchStore: {} as unknown as DispatchStore,
        leaseStore: { reopenLease: vi.fn() } as unknown as LeaseStore,
        publish: vi.fn(),
        decisionStore,
      },
      { sweepMs: 30_000, visibilityMs: 5000, maxAttempts: 3, oracleDor: false, taskWorker: false, decisionRouting: true },
    )
    // 기존 2개(decomposition·completion) + decision 소비자 전용 연결 1개 = 3(makeRedis 호출 카운트로 배선 행동 단언).
    expect(makeRedis).toHaveBeenCalledTimes(3)
    expect(sup).toBeInstanceOf(Supervisor)
  })

  it('decisionRouting=false면 결정 소비자 미배선(전용 연결 추가 없음·회귀 0)', () => {
    const makeRedis = vi.fn(() => ({}) as unknown as Redis)
    const decisionStore = { createRequest: vi.fn(), getRequest: vi.fn() }
    const sup = createSupervisor(
      makeRedis,
      {
        repo: {} as unknown as TaskGraphRepo,
        dispatchStore: {} as unknown as DispatchStore,
        leaseStore: {} as unknown as LeaseStore,
        publish: vi.fn(),
        decisionStore,
      },
      { sweepMs: 30_000, visibilityMs: 5000, maxAttempts: 3, oracleDor: false, taskWorker: false, decisionRouting: false },
    )
    expect(makeRedis).toHaveBeenCalledTimes(2)
    expect(sup).toBeInstanceOf(Supervisor)
  })
})

describe('Supervisor + oracleConsumer (P3-1)', () => {
  const fake = () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() })
  it('start/stop이 oracleConsumer를 포함(주입 시)', () => {
    const oracleConsumer = fake()
    const sup = new Supervisor({
      decompositionConsumer: fake(), completionConsumer: fake(), leaseSweeper: { start: vi.fn(), stop: vi.fn() }, oracleConsumer,
    })
    sup.start(); sup.stop()
    expect(oracleConsumer.start).toHaveBeenCalled()
    expect(oracleConsumer.stop).toHaveBeenCalled()
  })
  it('oracleConsumer 미주입이면 start/stop이 throw하지 않음(flag off)', () => {
    const sup = new Supervisor({ decompositionConsumer: fake(), completionConsumer: fake(), leaseSweeper: { start: vi.fn(), stop: vi.fn() } })
    expect(() => { sup.start(); sup.stop() }).not.toThrow()
  })
})

describe('shouldWireOracleConsumer (D4 순수 게이트)', () => {
  it('oracleDor·hasOracleStore 둘 다 true여야 true(나머지 false)', () => {
    expect(shouldWireOracleConsumer(false, true)).toBe(false)
    expect(shouldWireOracleConsumer(true, false)).toBe(false)
    expect(shouldWireOracleConsumer(false, false)).toBe(false)
    expect(shouldWireOracleConsumer(true, true)).toBe(true)
  })
})

describe('shouldWireRiskConsumer (P2r-4 순수 게이트)', () => {
  it('shouldWireRiskConsumer: 둘 다 true여야 배선', () => {
    expect(shouldWireRiskConsumer(true, true)).toBe(true)
    expect(shouldWireRiskConsumer(false, true)).toBe(false)
    expect(shouldWireRiskConsumer(true, false)).toBe(false)
    expect(shouldWireRiskConsumer(false, false)).toBe(false)
  })
})

describe('shouldWireDecisionRoute (P6)', () => {
  it('routing + pool + auth → wire', () => { expect(shouldWireDecisionRoute(true, true, true)).toBe('wire') })
  it('routing + pool + no auth → warn(미등록)', () => { expect(shouldWireDecisionRoute(true, true, false)).toBe('warn') })
  it('routing off → skip', () => { expect(shouldWireDecisionRoute(false, true, true)).toBe('skip') })
  it('no pool → skip', () => { expect(shouldWireDecisionRoute(true, false, true)).toBe('skip') })
})

describe('createSupervisor oracleDor 게이트 (P3-2)', () => {
  const makeRedis = () => ({}) as unknown as Redis
  const baseDeps = {
    repo: {} as unknown as TaskGraphRepo,
    dispatchStore: {} as unknown as DispatchStore,
    leaseStore: {} as unknown as LeaseStore,
    publish: vi.fn(),
    oracleStore: { upsertDraft: vi.fn(), approvedByWorkflow: vi.fn() } as never,
  }
  it('oracleStore 주입 + oracleDor=false면 조립 성공(consumer upsert용·oracleConsumer 미배선)', () => {
    expect(createSupervisor(makeRedis, baseDeps, { sweepMs: 1, visibilityMs: 1, maxAttempts: 3, oracleDor: false, taskWorker: false })).toBeInstanceOf(Supervisor)
  })
  it('oracleDor=true면 조립 성공(satisfied-set+oracleConsumer)', () => {
    expect(createSupervisor(makeRedis, baseDeps, { sweepMs: 1, visibilityMs: 1, maxAttempts: 3, oracleDor: true, taskWorker: false })).toBeInstanceOf(Supervisor)
  })
})

describe('createSupervisor worker 배선 (P4-1)', () => {
  const makeRedis = () => ({}) as unknown as Redis
  const handlers = { develop_code: { execute: vi.fn() } }
  const base = {
    repo: {} as unknown as TaskGraphRepo,
    dispatchStore: {} as unknown as DispatchStore,
    leaseStore: {} as unknown as LeaseStore,
    publish: vi.fn(),
  }
  const cfg = (over: Partial<{ taskWorker: boolean }> = {}) =>
    ({ sweepMs: 1, visibilityMs: 1, maxAttempts: 3, oracleDor: false, taskWorker: false, ...over })
  it('taskWorker=false면 worker 미배선이어도 조립 성공', () => {
    expect(createSupervisor(makeRedis, base, cfg())).toBeInstanceOf(Supervisor)
  })
  it('taskWorker=true + handlers 주입이면 조립 성공(worker 배선)', () => {
    expect(createSupervisor(makeRedis, { ...base, handlers }, cfg({ taskWorker: true }))).toBeInstanceOf(Supervisor)
  })
  it('wpVerify=true + worker 배선이면 조립 성공(검증 게이트 스레딩·P4b-1)', () => {
    expect(
      createSupervisor(makeRedis, { ...base, handlers }, { ...cfg({ taskWorker: true }), wpVerify: true }),
    ).toBeInstanceOf(Supervisor)
  })
})

describe('buildWorkerConsumerDeps (P4b-1 — wpVerify 스레딩 행동 검증)', () => {
  const leaseStoreMock = { renewLease: vi.fn() } as unknown as LeaseStore
  const d = {
    repo: {} as unknown as TaskGraphRepo,
    publish: vi.fn(),
    handlers: { develop_code: { execute: vi.fn() } },
    leaseStore: leaseStoreMock,
  }
  const base = { sweepMs: 1, visibilityMs: 1, maxAttempts: 3, oracleDor: false, taskWorker: true }
  it('하드닝: lease 하트비트 — leaseStore·visibilityMs를 워커 deps에 스레딩(누락이 무음 회귀 안 되게 단언)', () => {
    const w = buildWorkerConsumerDeps(d, base)
    expect(w.leaseStore).toBe(leaseStoreMock)
    expect(w.visibilityMs).toBe(1)
  })
  it('wpVerify=true → verifyEnabled=true', () => {
    expect(buildWorkerConsumerDeps(d, { ...base, wpVerify: true }).verifyEnabled).toBe(true)
  })
  it('wpVerify=false → verifyEnabled=false', () => {
    expect(buildWorkerConsumerDeps(d, { ...base, wpVerify: false }).verifyEnabled).toBe(false)
  })
  it('wpVerify 미지정(레거시 config) → verifyEnabled=false(기본 off)', () => {
    expect(buildWorkerConsumerDeps(d, base).verifyEnabled).toBe(false)
  })
  it('완료 스트림은 completion 소비자 구독 스트림과 단일 출처로 일치', () => {
    expect(buildWorkerConsumerDeps(d, base).completionStream).toBe('manager:completions:main')
  })
})

describe('buildWorkerConsumerDeps conformance (P4b-2)', () => {
  const base = { repo: {} as never, publish: vi.fn(), handlers: { develop_code: { execute: vi.fn() } } }
  const cfg = { sweepMs: 1, visibilityMs: 1, maxAttempts: 3, oracleDor: false, taskWorker: true } as never

  it('conformanceEnabled true only when wpConformance && oracleStore both present', () => {
    const store = { approvedOracleForStory: vi.fn() }
    expect(buildWorkerConsumerDeps({ ...base, oracleStore: store as never }, { ...cfg, wpConformance: true }).conformanceEnabled).toBe(true)
    expect(buildWorkerConsumerDeps({ ...base, oracleStore: store as never }, { ...cfg, wpConformance: false }).conformanceEnabled).toBe(false)
    expect(buildWorkerConsumerDeps(base, { ...cfg, wpConformance: true }).conformanceEnabled).toBe(false) // oracleStore 부재
    expect(buildWorkerConsumerDeps(base, cfg).conformanceEnabled).toBe(false) // wpConformance 미지정
  })

  it('passes oracleStore through when present', () => {
    const store = { approvedOracleForStory: vi.fn() }
    expect(buildWorkerConsumerDeps({ ...base, oracleStore: store as never }, { ...cfg, wpConformance: true }).oracleStore).toBe(store)
  })
})

describe('buildWorkerConsumerDeps golden 사인오프 (Slice 1)', () => {
  const base = { repo: {} as never, publish: vi.fn(), handlers: { develop_code: { execute: vi.fn() } } }
  const cfg = { sweepMs: 1, visibilityMs: 1, maxAttempts: 3, oracleDor: false, taskWorker: true } as never
  const oracleStore = { unfrozenGoldenCount: vi.fn() }
  const decisionStore = { createRequest: vi.fn() }

  it('goldenSignoffEnabled true only when goldenSignoff && oracleStore && decisionStore 셋 다', () => {
    expect(buildWorkerConsumerDeps({ ...base, oracleStore: oracleStore as never, decisionStore: decisionStore as never }, { ...cfg, goldenSignoff: true }).goldenSignoffEnabled).toBe(true)
    expect(buildWorkerConsumerDeps({ ...base, oracleStore: oracleStore as never, decisionStore: decisionStore as never }, { ...cfg, goldenSignoff: false }).goldenSignoffEnabled).toBe(false)
    expect(buildWorkerConsumerDeps({ ...base, oracleStore: oracleStore as never }, { ...cfg, goldenSignoff: true }).goldenSignoffEnabled).toBe(false) // decisionStore 부재
    expect(buildWorkerConsumerDeps({ ...base, decisionStore: decisionStore as never }, { ...cfg, goldenSignoff: true }).goldenSignoffEnabled).toBe(false) // oracleStore 부재
  })

  it('decisionStore를 worker deps로 통과', () => {
    expect(buildWorkerConsumerDeps({ ...base, oracleStore: oracleStore as never, decisionStore: decisionStore as never }, { ...cfg, goldenSignoff: true }).decisionStore).toBe(decisionStore)
  })
})

describe('shouldWireGoldenSignoff (Slice 1 순수 게이트)', () => {
  it('flag + oracleStore + decisionStore 셋 다여야 true', () => {
    expect(shouldWireGoldenSignoff(true, true, true)).toBe(true)
    expect(shouldWireGoldenSignoff(false, true, true)).toBe(false)
    expect(shouldWireGoldenSignoff(true, false, true)).toBe(false)
    expect(shouldWireGoldenSignoff(true, true, false)).toBe(false)
  })
})

describe('buildWorkerConsumerDeps mutation (P4)', () => {
  const base = { repo: {} as never, publish: vi.fn(), handlers: { develop_code: { execute: vi.fn() } } }
  const cfg = { sweepMs: 1, visibilityMs: 1, maxAttempts: 3, oracleDor: false, taskWorker: true } as never

  it('mutationEnabled = wpMutation === true (oracle 무관)', () => {
    expect(buildWorkerConsumerDeps(base as never, { ...cfg, wpMutation: true }).mutationEnabled).toBe(true)
    expect(buildWorkerConsumerDeps(base as never, { ...cfg, wpMutation: false }).mutationEnabled).toBe(false)
    expect(buildWorkerConsumerDeps(base as never, cfg).mutationEnabled).toBe(false)
  })

  it('theta/minRisk/maxMutants를 워커 deps에 스레딩', () => {
    const w = buildWorkerConsumerDeps(base as never, { ...cfg, wpMutation: true, mutationTheta: 0.8, mutationMinRisk: 'MEDIUM', mutationMaxMutants: 5 })
    expect(w.mutationTheta).toBe(0.8)
    expect(w.mutationMinRisk).toBe('MEDIUM')
    expect(w.mutationMaxMutants).toBe(5)
  })

  it('wpMutation off면 theta/minRisk/maxMutants 미전달(키 미생성)', () => {
    const w = buildWorkerConsumerDeps(base as never, { ...cfg, wpMutation: false })
    expect(w.mutationEnabled).toBe(false)
    expect(w.mutationTheta).toBeUndefined()
    expect(w.mutationMinRisk).toBeUndefined()
    expect(w.mutationMaxMutants).toBeUndefined()
  })
})

describe('buildWorkerConsumerDeps security (P4 4d)', () => {
  test('buildWorkerConsumerDeps: wpSecurity true → securityEnabled true', () => {
    const deps = buildWorkerConsumerDeps(
      { repo: {} as never, publish: vi.fn(), handlers: {} },
      { sweepMs: 1, visibilityMs: 1, maxAttempts: 1, oracleDor: false, taskWorker: true, wpSecurity: true, securityMinSeverity: 'high' },
    )
    expect(deps.securityEnabled).toBe(true)
    expect(deps.securityMinSeverity).toBe('high')
  })

  test('buildWorkerConsumerDeps: wpSecurity 미설정 → securityEnabled false', () => {
    const deps = buildWorkerConsumerDeps(
      { repo: {} as never, publish: vi.fn(), handlers: {} },
      { sweepMs: 1, visibilityMs: 1, maxAttempts: 1, oracleDor: false, taskWorker: true },
    )
    expect(deps.securityEnabled).toBe(false)
  })
})

describe('buildWorkerConsumerDeps releaseGate (P5-1)', () => {
  it('threads releaseGate flag + store into WorkerDeps (P5-1)', () => {
    const releaseStore = { recordEvidence: async () => {} }
    const deps = buildWorkerConsumerDeps(
      { repo: {} as never, publish: async () => {}, handlers: {}, leaseStore: {} as never, releaseStore } as never,
      { sweepMs: 1, visibilityMs: 1, maxAttempts: 1, oracleDor: false, taskWorker: true, releaseGate: true } as never,
    )
    expect(deps.releaseGateEnabled).toBe(true)
    expect(deps.releaseStore).toBe(releaseStore)
  })
  it('releaseGateEnabled false when flag off (regression 0)', () => {
    const deps = buildWorkerConsumerDeps(
      { repo: {} as never, publish: async () => {}, handlers: {}, leaseStore: {} as never } as never,
      { sweepMs: 1, visibilityMs: 1, maxAttempts: 1, oracleDor: false, taskWorker: true } as never,
    )
    expect(deps.releaseGateEnabled).toBe(false)
  })
})

describe('createSupervisor B1 decisionSweeper', () => {
  // 기존 createSupervisor 테스트 패턴 — makeRedis는 ({}) as Redis 반환, deps는 as never 캐스팅.
  // decisionStore에 expiredPendingRequests/expireRequest 포함 — SupervisorDeps 인터섹션 만족 단언.
  const makeRedis = () => ({}) as unknown as Redis
  const baseDecisionStore = () => ({
    createRequest: vi.fn(),
    getRequest: vi.fn().mockResolvedValue(null),
    recordSignOff: vi.fn(),
    expiredPendingRequests: vi.fn(async () => []),
    expireRequest: vi.fn(),
  })
  const baseDeps = () => ({
    repo: {} as never,
    dispatchStore: {} as never,
    leaseStore: {} as never,
    publish: vi.fn(),
    decisionStore: baseDecisionStore() as never,
  })
  const cfg = (over: Record<string, unknown> = {}) =>
    ({ sweepMs: 1, visibilityMs: 1, maxAttempts: 1, oracleDor: false, taskWorker: false, ...over })

  it('decisionExpiry+decisionStore → start/stop이 throw 없이 동작(decisionSweeper 배선)', () => {
    const sup = createSupervisor(
      makeRedis,
      baseDeps(),
      cfg({ decisionExpiry: true, decisionSweepMs: 1000, decisionTtlMs: 3_600_000 }) as never,
    )
    expect(() => { sup.start(); sup.stop() }).not.toThrow()
  })

  it('decisionExpiry off → 회귀(start/stop throw 0)', () => {
    const sup = createSupervisor(
      makeRedis,
      baseDeps(),
      cfg({ decisionExpiry: false }) as never,
    )
    expect(() => { sup.start(); sup.stop() }).not.toThrow()
  })

  it('decisionExpiry true, decisionStore 미주입 → decisionSweeper 미배선(조립 성공·회귀 0)', () => {
    const deps = { repo: {} as never, dispatchStore: {} as never, leaseStore: {} as never, publish: vi.fn() }
    const sup = createSupervisor(makeRedis, deps, cfg({ decisionExpiry: true, decisionSweepMs: 1000 }) as never)
    expect(() => { sup.start(); sup.stop() }).not.toThrow()
  })
})

describe('createSupervisor B1 decisionExpiryConsumer', () => {
  // B1: DecisionExpiredConsumer 배선 — decisionExpiry+decisionStore 주입 시만 makeRedis 추가 호출(배선 단언).
  const baseDecisionStore = () => ({
    createRequest: vi.fn(),
    getRequest: vi.fn().mockResolvedValue(null),
    recordSignOff: vi.fn(),
    expiredPendingRequests: vi.fn(async () => []),
    expireRequest: vi.fn(),
  })
  const baseDeps = () => ({
    repo: {} as never,
    dispatchStore: {} as never,
    leaseStore: {} as never,
    publish: vi.fn(),
    decisionStore: baseDecisionStore() as never,
  })
  const cfg = (over: Record<string, unknown> = {}) =>
    ({ sweepMs: 1, visibilityMs: 1, maxAttempts: 1, oracleDor: false, taskWorker: false, ...over })

  it('decisionExpiry+decisionStore → start/stop이 throw 없이 동작(expiryConsumer 배선)', () => {
    const makeRedis = vi.fn(() => ({}) as unknown as Redis)
    const sup = createSupervisor(
      makeRedis,
      baseDeps(),
      cfg({ decisionExpiry: true, decisionSweepMs: 1000, decisionTtlMs: 3_600_000, decisionReescalateMax: 2 }) as never,
    )
    expect(() => { sup.start(); sup.stop() }).not.toThrow()
    // decisionExpiry+decisionStore: makeRedis 추가 호출(decisionExpiryConsumer 전용 연결)
    // 기본 2(decomposition·completion) + 1(decisionExpiryConsumer) = 3
    expect(makeRedis.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('decisionExpiry false → expiryConsumer 미배선(회귀 0·throw 없음)', () => {
    const makeRedis = vi.fn(() => ({}) as unknown as Redis)
    const sup = createSupervisor(
      makeRedis,
      baseDeps(),
      cfg({ decisionExpiry: false }) as never,
    )
    expect(() => { sup.start(); sup.stop() }).not.toThrow()
    // decisionExpiry off: 기본 makeRedis 2회만(decisionSweeper/expiryConsumer 미배선)
    expect(makeRedis).toHaveBeenCalledTimes(2)
  })
})

describe('buildWorkerConsumerDeps G1 서킷 스레딩', () => {
  const base = { repo: {} as never, publish: vi.fn(), handlers: { develop_code: { execute: vi.fn() } } }
  const cfg = { sweepMs: 1, visibilityMs: 1, maxAttempts: 3, oracleDor: false, taskWorker: true } as never

  it('budget 주입 시 WorkerDeps.budget에 스레딩', () => {
    const budget = { check: vi.fn(), record: vi.fn() } as never
    const w = buildWorkerConsumerDeps({ ...base, budget } as never, cfg)
    expect(w.budget).toBe(budget)
  })

  it('provider 주입 시 WorkerDeps.provider에 스레딩', () => {
    const provider = { before: vi.fn(), onSuccess: vi.fn(), onFailure: vi.fn() } as never
    const w = buildWorkerConsumerDeps({ ...base, provider } as never, cfg)
    expect(w.provider).toBe(provider)
  })

  it('isProviderFailure 주입 시 WorkerDeps.isProviderFailure에 스레딩', () => {
    const isProviderFailure = (err: unknown) => err instanceof Error
    const w = buildWorkerConsumerDeps({ ...base, isProviderFailure } as never, cfg)
    expect(w.isProviderFailure).toBe(isProviderFailure)
  })

  it('breaker 미주입이면 WorkerDeps에 키 미생성(회귀 0)', () => {
    const w = buildWorkerConsumerDeps(base as never, cfg)
    expect(w.budget).toBeUndefined()
    expect(w.provider).toBeUndefined()
    expect(w.isProviderFailure).toBeUndefined()
  })
})

describe('drainHeld', () => {
  it('held를 드레인(비움)하고 각 id에 dispatchOne 호출', async () => {
    const held = new Set(['wf-1', 'wf-2'])
    const calls: string[] = []
    await drainHeld(held, async (wf) => { calls.push(wf) })
    expect(calls.sort()).toEqual(['wf-1', 'wf-2'])
    expect(held.size).toBe(0)
  })

  it('per-item throw가 나머지를 비차단(never-throw)', async () => {
    const held = new Set(['wf-1', 'wf-2'])
    const ok: string[] = []
    await expect(drainHeld(held, async (wf) => {
      if (wf === 'wf-1') throw new Error('boom')
      ok.push(wf)
    })).resolves.toBeUndefined()
    expect(ok).toEqual(['wf-2'])
    expect(held.size).toBe(0)
  })

  it('빈 set은 no-op', async () => {
    const dispatchOne = vi.fn()
    await drainHeld(new Set(), dispatchOne)
    expect(dispatchOne).not.toHaveBeenCalled()
  })
})

describe('Supervisor.resumeDispatch', () => {
  it('resumeDispatch 컴포넌트에 위임', async () => {
    const resumeDispatch = vi.fn().mockResolvedValue(undefined)
    const noop = { start: async () => {}, stop: () => {} }
    const sweeper = { start: () => {}, stop: () => {} }
    const sup = new Supervisor({
      decompositionConsumer: noop, completionConsumer: noop, leaseSweeper: sweeper, resumeDispatch,
    })
    await sup.resumeDispatch()
    expect(resumeDispatch).toHaveBeenCalledTimes(1)
  })

  it('resumeDispatch 미주입이면 no-op(throw 없음)', async () => {
    const noop = { start: async () => {}, stop: () => {} }
    const sweeper = { start: () => {}, stop: () => {} }
    const sup = new Supervisor({ decompositionConsumer: noop, completionConsumer: noop, leaseSweeper: sweeper })
    await expect(sup.resumeDispatch()).resolves.toBeUndefined()
  })
})

describe('buildDispatchGate (P5-3b)', () => {
  it('getMode 미주입이면 base dispatch 그대로 반환·resumeDispatch undefined(회귀 0)', () => {
    const base = { repo: {} as never, store: {} as never, visibilityMs: 5000 }
    const result = buildDispatchGate(base, undefined)
    expect(result.dispatch).toBe(base)
    expect(result.resumeDispatch).toBeUndefined()
    expect('getMode' in result.dispatch).toBe(false)
    expect('onHeld' in result.dispatch).toBe(false)
  })

  it('getMode 주입 시 dispatch에 getMode·onHeld 합류·resumeDispatch는 함수', () => {
    const base = { repo: {} as never, store: {} as never, visibilityMs: 5000 }
    const getMode = () => 'SAFE' as const
    const result = buildDispatchGate(base, getMode)
    expect(result.dispatch.getMode).toBe(getMode)
    expect(typeof result.dispatch.onHeld).toBe('function')
    expect(typeof result.resumeDispatch).toBe('function')
    // base 객체 자체는 변경되지 않아야 함(순수)
    expect('getMode' in base).toBe(false)
  })

  it('onHeld로 held-set에 쌓인 wf를 resumeDispatch가 드레인(repo.getGraph 각 wf로 호출)', async () => {
    const getGraph = vi.fn().mockResolvedValue(null)
    const base = {
      repo: { getGraph, latestStates: vi.fn().mockResolvedValue([]) } as never,
      store: {} as never,
      visibilityMs: 5000,
    }
    const { dispatch, resumeDispatch } = buildDispatchGate(base, () => 'SAFE' as const)
    dispatch.onHeld!('wf-1')
    dispatch.onHeld!('wf-2')
    await resumeDispatch!()
    expect(getGraph).toHaveBeenCalledWith('wf-1')
    expect(getGraph).toHaveBeenCalledWith('wf-2')
  })
})

describe('shouldWireDegradedSignoff', () => {
  it('degradedSignoff + decisionStore 둘 다여야 true', () => {
    expect(shouldWireDegradedSignoff(true, true)).toBe(true)
    expect(shouldWireDegradedSignoff(true, false)).toBe(false)
    expect(shouldWireDegradedSignoff(false, true)).toBe(false)
  })
})
