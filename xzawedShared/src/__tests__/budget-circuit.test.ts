import { describe, it, expect } from 'vitest'
import {
  costOf,
  MODEL_PRICING,
  BudgetCircuitBreaker,
  BudgetExceededError,
} from '../budget/budget-circuit.js'

describe('costOf', () => {
  it('sonnet-4-6 가격($3/$15 per Mtok)으로 환산한다', () => {
    // (1000×3 + 1000×15) / 1e6 = 0.018
    expect(costOf('claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 1000 })).toBeCloseTo(0.018, 10)
  })

  it('opus-4-8 가격($5/$25)으로 환산한다', () => {
    expect(costOf('claude-opus-4-8', { input_tokens: 1000, output_tokens: 1000 })).toBeCloseTo(0.03, 10)
  })

  it('미지 모델은 기본가(Opus-tier $5/$25·보수적)로 폴백한다', () => {
    expect(costOf('made-up-model', { input_tokens: 1000, output_tokens: 1000 })).toBeCloseTo(0.03, 10)
  })

  it('캐시 토큰을 가중(쓰기 1.25·읽기 0.1)해 환산한다', () => {
    // sonnet: (0 + 1000×1.25 + 1000×0.1)×3 / 1e6 = 1350×3/1e6 = 0.00405
    const c = costOf('claude-sonnet-4-6', {
      input_tokens: 0, output_tokens: 0,
      cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000,
    })
    expect(c).toBeCloseTo(0.00405, 10)
  })

  it('필드 누락은 0으로 본다(빈 usage는 비용 0)', () => {
    expect(costOf('claude-opus-4-8', {})).toBe(0)
  })

  it('MODEL_PRICING은 주요 모델을 포함한다', () => {
    expect(MODEL_PRICING['claude-sonnet-4-6']).toEqual({ inputPerMtok: 3, outputPerMtok: 15 })
    expect(MODEL_PRICING['claude-fable-5']).toEqual({ inputPerMtok: 10, outputPerMtok: 50 })
  })
})

describe('BudgetCircuitBreaker', () => {
  const fixedNow = () => Date.parse('2026-06-11T10:00:00Z')

  it('상한 미설정(0/미지정)이면 절대 트립하지 않는다(비활성)', () => {
    const b = new BudgetCircuitBreaker({ now: fixedNow })
    for (let i = 0; i < 100; i++) b.record('wf-1', 'claude-opus-4-8', { input_tokens: 1_000_000, output_tokens: 1_000_000 })
    expect(() => b.check('wf-1')).not.toThrow()
    expect(b.snapshot('wf-1').tripped).toBe(false)
  })

  it('워크플로 누적이 상한 이상이면 check가 BudgetExceededError를 던진다(fail-closed)', () => {
    const b = new BudgetCircuitBreaker({ perWorkflowUsd: 0.05, now: fixedNow })
    expect(() => b.check('wf-1')).not.toThrow() // 0 spent
    // opus 1000/1000 = (1000×5 + 1000×25)/1e6 = $0.03 누적 → 아직 < 0.05
    b.record('wf-1', 'claude-opus-4-8', { input_tokens: 1000, output_tokens: 1000 })
    expect(() => b.check('wf-1')).not.toThrow()
    // 한 번 더 → $0.06 ≥ 0.05 → 트립
    const r = b.record('wf-1', 'claude-opus-4-8', { input_tokens: 1000, output_tokens: 1000 })
    expect(r.tripped).toBe(true)
    expect(() => b.check('wf-1')).toThrow(BudgetExceededError)
  })

  it('워크플로 트립은 다른 워크플로를 막지 않는다(격리)', () => {
    const b = new BudgetCircuitBreaker({ perWorkflowUsd: 0.05, now: fixedNow })
    b.record('wf-1', 'claude-opus-4-8', { input_tokens: 2000, output_tokens: 2000 }) // $0.06
    expect(() => b.check('wf-1')).toThrow(BudgetExceededError)
    expect(() => b.check('wf-2')).not.toThrow()
  })

  it('일 누적 상한은 워크플로를 가로질러 합산되어 트립한다', () => {
    const b = new BudgetCircuitBreaker({ dailyUsd: 0.04, now: fixedNow })
    b.record('wf-1', 'claude-opus-4-8', { input_tokens: 1000, output_tokens: 0 }) // 1000×5/1e6 = $0.005
    b.record('wf-2', 'claude-opus-4-8', { input_tokens: 9000, output_tokens: 0 }) // +$0.045 = ~$0.05 ≥ 0.04
    const err = (() => { try { b.check('wf-3'); return null } catch (e) { return e } })()
    expect(err).toBeInstanceOf(BudgetExceededError)
    expect((err as BudgetExceededError).scope).toBe('daily')
  })

  it('날짜가 바뀌면 일 카운터가 리셋된다(롤오버)', () => {
    let day = 0
    const now = () => Date.parse(`2026-06-${11 + day}T10:00:00Z`)
    const b = new BudgetCircuitBreaker({ dailyUsd: 0.05, now })
    b.record('wf-1', 'claude-opus-4-8', { input_tokens: 10_000, output_tokens: 0 }) // 10000×5/1e6 = $0.05 → 트립
    expect(() => b.check('wf-1')).toThrow(BudgetExceededError)
    day = 1 // 다음 날
    expect(() => b.check('wf-1')).not.toThrow() // 일 카운터 리셋
    expect(b.snapshot('wf-1').dailyUsd).toBe(0)
  })

  it('BudgetExceededError는 scope·workflowId·spentUsd·capUsd를 담는다', () => {
    const b = new BudgetCircuitBreaker({ perWorkflowUsd: 0.01, now: fixedNow })
    b.record('wf-x', 'claude-opus-4-8', { input_tokens: 1000, output_tokens: 1000 }) // $0.03
    try {
      b.check('wf-x')
      throw new Error('should have thrown')
    } catch (e) {
      const err = e as BudgetExceededError
      expect(err.scope).toBe('workflow')
      expect(err.workflowId).toBe('wf-x')
      expect(err.spentUsd).toBeCloseTo(0.03, 10)
      expect(err.capUsd).toBe(0.01)
    }
  })

  it('record는 워크플로·일 누적과 트립 여부를 반환한다', () => {
    const b = new BudgetCircuitBreaker({ perWorkflowUsd: 1, now: fixedNow })
    const r = b.record('wf-1', 'claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 0 }) // 1000×3/1e6 = $0.003
    expect(r.workflowUsd).toBeCloseTo(0.003, 10)
    expect(r.dailyUsd).toBeCloseTo(0.003, 10)
    expect(r.tripped).toBe(false)
  })

  it('dailyTripped: 일 상한 미만 false·이상 true', () => {
    let t = 0
    const b = new BudgetCircuitBreaker({ dailyUsd: 0.01, now: () => t })
    expect(b.dailyTripped()).toBe(false)
    b.record('wf-1', 'claude-opus-4-8', { input_tokens: 100000, output_tokens: 100000 }) // 상한 초과 비용
    expect(b.dailyTripped()).toBe(true)
  })
  it('dailyTripped: 일 롤오버 시 리셋', () => {
    let day = 0
    const b = new BudgetCircuitBreaker({ dailyUsd: 0.0001, now: () => day })
    b.record('wf-1', 'claude-opus-4-8', { input_tokens: 100000, output_tokens: 100000 })
    expect(b.dailyTripped()).toBe(true)
    day = 24 * 3600 * 1000 + 1 // 다음 날(UTC)
    expect(b.dailyTripped()).toBe(false)
  })
  it('dailyTripped: dailyUsd 미설정(Infinity)이면 항상 false', () => {
    const b = new BudgetCircuitBreaker({ now: () => 0 })
    b.record('wf-1', 'claude-opus-4-8', { input_tokens: 100000, output_tokens: 100000 })
    expect(b.dailyTripped()).toBe(false)
  })
})
