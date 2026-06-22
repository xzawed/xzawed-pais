import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage, BudgetCircuitBreaker } from '@xzawed/agent-streams'
import { produceAdvisory } from './advisory.js'
import type { AdvisoryStore } from './advisory.js'

const wp = { id: 'wp-1', storyId: 'story-1', owningRole: 'developer', acceptanceCriteria: ['AC1'] } as unknown as WorkPackage
const result = { artifacts: ['src/foo.ts'] }

/** ClaudeLike mock — callClaudeText는 messages.create를 호출하고 content[].text를 추출한다. */
function claudeReturning(text: string) {
  return { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } }
}
function claudeThrowing() {
  return { messages: { create: vi.fn().mockRejectedValue(new Error('provider boom')) } }
}
const baseDeps = (claude: unknown, store: AdvisoryStore) => ({
  claude: claude as never, model: 'm', timeoutMs: 1000, advisoryStore: store,
})

describe('produceAdvisory', () => {
  test('유효한 LLM JSON이면 순위 매긴 findings를 recordFindings로 영속한다', async () => {
    const store: AdvisoryStore = { recordFindings: vi.fn().mockResolvedValue(undefined) }
    const claude = claudeReturning(JSON.stringify({ findings: [{ title: 'a', rationale: 'ra' }, { title: 'b', rationale: 'rb' }] }))
    await produceAdvisory('wf-1', wp, 0, result, baseDeps(claude, store))
    expect(store.recordFindings).toHaveBeenCalledTimes(1)
    const args = (store.recordFindings as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(args[0]).toBe('wf-1'); expect(args[1]).toBe('wp-1'); expect(args[2]).toBe(0)
    expect(args[3]).toEqual([
      { rank: 1, title: 'a', rationale: 'ra', severity: 'advisory', sourceLens: 'optimization' },
      { rank: 2, title: 'b', rationale: 'rb', severity: 'advisory', sourceLens: 'optimization' },
    ])
  })

  test('비JSON/비배열/부분필드 출력은 fail-soft — recordFindings 미호출(no-op)', async () => {
    const store: AdvisoryStore = { recordFindings: vi.fn().mockResolvedValue(undefined) }
    await produceAdvisory('wf-1', wp, 0, result, baseDeps(claudeReturning('not json'), store))
    await produceAdvisory('wf-1', wp, 0, result, baseDeps(claudeReturning(JSON.stringify({ findings: [{ title: 'x' }] })), store))
    expect(store.recordFindings).not.toHaveBeenCalled()
  })

  test('LLM 호출이 throw해도 produceAdvisory는 throw하지 않는다(never-throw·N3-b)', async () => {
    const store: AdvisoryStore = { recordFindings: vi.fn().mockResolvedValue(undefined) }
    await expect(produceAdvisory('wf-1', wp, 0, result, baseDeps(claudeThrowing(), store))).resolves.toBeUndefined()
    expect(store.recordFindings).not.toHaveBeenCalled()
  })

  test('recordFindings가 throw해도 produceAdvisory는 throw하지 않는다(best-effort)', async () => {
    const store: AdvisoryStore = { recordFindings: vi.fn().mockRejectedValue(new Error('db boom')) }
    const claude = claudeReturning(JSON.stringify({ findings: [{ title: 'a', rationale: 'ra' }] }))
    await expect(produceAdvisory('wf-1', wp, 0, result, baseDeps(claude, store))).resolves.toBeUndefined()
  })

  test('MAX_ADVISORY_FINDINGS(8) 초과는 절단', async () => {
    const store: AdvisoryStore = { recordFindings: vi.fn().mockResolvedValue(undefined) }
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, rationale: `r${i}` }))
    const claude = claudeReturning(JSON.stringify({ findings: many }))
    await produceAdvisory('wf-1', wp, 0, result, baseDeps(claude, store))
    const args = (store.recordFindings as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(args[3]).toHaveLength(8)
    expect(args[3][7].rank).toBe(8)
  })
})

describe('produceAdvisory — G1 서킷 배선', () => {
  test('budget breaker 주입 시 check(workflowId)가 호출된다', async () => {
    const store: AdvisoryStore = { recordFindings: vi.fn().mockResolvedValue(undefined) }
    const claude = claudeReturning(JSON.stringify({ findings: [{ title: 'a', rationale: 'ra' }] }))
    const budget = { check: vi.fn(), record: vi.fn() } as unknown as BudgetCircuitBreaker
    await produceAdvisory('wf-1', wp, 0, result, { ...baseDeps(claude, store), budget })
    expect(budget.check).toHaveBeenCalledWith('wf-1')
  })

  test('budget breaker 미주입이면 resolves(never-throw·회귀 0)', async () => {
    const store: AdvisoryStore = { recordFindings: vi.fn().mockResolvedValue(undefined) }
    const claude = claudeReturning(JSON.stringify({ findings: [{ title: 'a', rationale: 'ra' }] }))
    // budget 미주입 → circuit undefined → 기존 경로(회귀 0)
    await expect(produceAdvisory('wf-1', wp, 0, result, baseDeps(claude, store))).resolves.toBeUndefined()
    expect(store.recordFindings).toHaveBeenCalledTimes(1)
  })

  test('budget breaker trip(check throw)해도 produceAdvisory never-throw(N3)', async () => {
    const store: AdvisoryStore = { recordFindings: vi.fn().mockResolvedValue(undefined) }
    const claude = claudeReturning(JSON.stringify({ findings: [{ title: 'a', rationale: 'ra' }] }))
    const budget = { check: vi.fn().mockImplementation(() => { throw new Error('budget exceeded') }), record: vi.fn() } as unknown as BudgetCircuitBreaker
    await expect(produceAdvisory('wf-1', wp, 0, result, { ...baseDeps(claude, store), budget })).resolves.toBeUndefined()
    // circuit open → fallback → findings=[] → recordFindings 미호출
    expect(store.recordFindings).not.toHaveBeenCalled()
  })
})
