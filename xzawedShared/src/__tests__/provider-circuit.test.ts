import { describe, it, expect } from 'vitest'
import {
  ProviderCircuitBreaker,
  ProviderCircuitOpenError,
} from '../resilience/provider-circuit.js'

describe('ProviderCircuitBreaker', () => {
  it('초기 상태는 closed — before()는 통과한다', () => {
    const b = new ProviderCircuitBreaker({ now: () => 0 })
    expect(() => b.before()).not.toThrow()
    expect(b.snapshot().state).toBe('closed')
  })

  it('연속 실패가 임계 미만이면 닫힌 채 통과한다', () => {
    const b = new ProviderCircuitBreaker({ failureThreshold: 3, now: () => 0 })
    expect(b.onFailure()).toBe(false)
    expect(b.onFailure()).toBe(false)
    expect(() => b.before()).not.toThrow()
    expect(b.snapshot().state).toBe('closed')
  })

  it('연속 실패가 임계에 도달하면 open되고 before가 fail-fast로 던진다', () => {
    const b = new ProviderCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000, now: () => 0 })
    b.onFailure()
    b.onFailure()
    expect(b.onFailure()).toBe(true) // 임계 도달 → 새로 open
    expect(b.snapshot().state).toBe('open')
    expect(() => b.before()).toThrow(ProviderCircuitOpenError)
  })

  it('onSuccess는 연속 실패 카운터를 리셋한다(조기 open 방지)', () => {
    const b = new ProviderCircuitBreaker({ failureThreshold: 3, now: () => 0 })
    b.onFailure()
    b.onFailure()
    b.onSuccess() // 리셋
    expect(b.onFailure()).toBe(false) // 카운트 1부터 다시
    expect(b.onFailure()).toBe(false)
    expect(() => b.before()).not.toThrow()
  })

  it('open 중 cooldown 미경과면 before가 계속 던진다', () => {
    let t = 0
    const b = new ProviderCircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000, now: () => t })
    b.onFailure() // open at t=0
    t = 10_000 // < cooldown
    expect(() => b.before()).toThrow(ProviderCircuitOpenError)
  })

  it('cooldown 경과 시 before가 half_open으로 전이해 1회 probe를 허용한다', () => {
    let t = 0
    const b = new ProviderCircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000, now: () => t })
    b.onFailure() // open
    t = 30_000 // cooldown 경과
    expect(() => b.before()).not.toThrow() // probe 허용
    expect(b.snapshot().state).toBe('half_open')
  })

  it('half_open에서 성공하면 closed로 복귀한다', () => {
    let t = 0
    const b = new ProviderCircuitBreaker({ failureThreshold: 1, cooldownMs: 10, now: () => t })
    b.onFailure() // open
    t = 100
    b.before() // half_open
    b.onSuccess()
    expect(b.snapshot().state).toBe('closed')
    expect(() => b.before()).not.toThrow()
  })

  it('half_open에서 실패하면 즉시 재open한다(probe 실패)', () => {
    let t = 0
    const b = new ProviderCircuitBreaker({ failureThreshold: 5, cooldownMs: 10, now: () => t })
    b.onFailure(); b.onFailure(); b.onFailure(); b.onFailure(); b.onFailure() // open at 5
    t = 100
    b.before() // half_open
    expect(b.onFailure()).toBe(true) // probe 실패 → 즉시 재open(임계 무관)
    expect(b.snapshot().state).toBe('open')
  })

  it('ProviderCircuitOpenError는 openedAt·cooldownMs를 담는다', () => {
    const b = new ProviderCircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000, now: () => 1234 })
    b.onFailure()
    try {
      b.before()
      throw new Error('should have thrown')
    } catch (e) {
      const err = e as ProviderCircuitOpenError
      expect(err.openedAt).toBe(1234)
      expect(err.cooldownMs).toBe(30_000)
    }
  })
})
