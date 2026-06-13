import { describe, it, test, expect, vi } from 'vitest'
import { makeEnvelope } from '@xzawed/agent-streams'
import {
  buildCompletionHandler, CompletionSignalSchema, Supervisor, createSupervisor, shouldWireSupervisor,
  shouldWireOracleConsumer, buildWorkerConsumerDeps,
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
