import { describe, it, expect, vi } from 'vitest'
import { makeEnvelope } from '@xzawed/agent-streams'
import {
  buildCompletionHandler, CompletionSignalSchema, Supervisor, createSupervisor, shouldWireSupervisor,
  shouldWireOracleConsumer,
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
})
