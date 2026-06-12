import { describe, test, expect, vi } from 'vitest'
import { buildWorkerConsumerDeps, type SupervisorConfig } from './supervisor.js'

const cfg = (over: Partial<SupervisorConfig> = {}): SupervisorConfig => ({
  sweepMs: 1, visibilityMs: 1, maxAttempts: 1, oracleDor: false, taskWorker: true, ...over,
})
const base = {
  repo: {} as never, publish: vi.fn(), leaseStore: {} as never,
  handlers: { develop_code: { execute: vi.fn() } },
}
const advisoryStore = { recordFindings: vi.fn() }
const claude = {} as never

describe('buildWorkerConsumerDeps advisory 배선', () => {
  test('wpAdvisory && advisoryStore 둘 다면 advisoryEnabled=true + LLM seam 스레딩', () => {
    const deps = buildWorkerConsumerDeps(
      { ...base, advisoryStore, claude, model: 'm', timeoutMs: 1000 },
      cfg({ wpAdvisory: true }),
    )
    expect(deps.advisoryEnabled).toBe(true)
    expect(deps.advisoryStore).toBe(advisoryStore)
    expect(deps.model).toBe('m')
    expect(deps.timeoutMs).toBe(1000)
  })

  test('wpAdvisory만 켜고 advisoryStore 부재면 advisoryEnabled=false(무음 no-op 방지·행동 단언)', () => {
    const deps = buildWorkerConsumerDeps({ ...base, claude, model: 'm', timeoutMs: 1000 }, cfg({ wpAdvisory: true }))
    expect(deps.advisoryEnabled).toBe(false)
  })

  test('wpAdvisory off면 advisoryEnabled=false(회귀 0)', () => {
    const deps = buildWorkerConsumerDeps({ ...base, advisoryStore, claude, model: 'm', timeoutMs: 1000 }, cfg({ wpAdvisory: false }))
    expect(deps.advisoryEnabled).toBe(false)
  })
})

describe('buildWorkerConsumerDeps impact 배선', () => {
  const oracleStore = { approvedOracleForStory: vi.fn(), approvedGoldensForStory: vi.fn() }
  test('wpImpact && oracleStore면 impactEnabled=true', () => {
    const deps = buildWorkerConsumerDeps({ ...base, oracleStore } as never, cfg({ wpImpact: true }))
    expect(deps.impactEnabled).toBe(true)
  })
  test('wpImpact만 켜고 oracleStore 부재면 impactEnabled=false(무음 no-op 방지·행동 단언)', () => {
    const deps = buildWorkerConsumerDeps({ ...base }, cfg({ wpImpact: true }))
    expect(deps.impactEnabled).toBe(false)
  })
  test('wpImpact off면 impactEnabled=false(회귀 0)', () => {
    const deps = buildWorkerConsumerDeps({ ...base, oracleStore } as never, cfg({ wpImpact: false }))
    expect(deps.impactEnabled).toBe(false)
  })
})
