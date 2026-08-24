import { describe, it, expect } from 'vitest'
import { evaluateReleaseGate, allWpDone, doneSetVersion } from './release-gate.js'
import type { ChannelOutcome } from '../db/release-gate.types.js'

const wp = (id: string) => ({ id, storyId: 's', owningRole: 'developer', acceptanceCriteria: [], risk: 'MEDIUM' }) as never
const ev = (m: Record<string, ChannelOutcome[]>) => new Map(Object.entries(m))

describe('evaluateReleaseGate', () => {
  it('all WPs tc:passed with no skips → passed', () => {
    const r = evaluateReleaseGate([wp('a'), wp('b')], ev({
      a: [{ channel: 'tc', outcome: 'passed' }, { channel: 'security', outcome: 'passed' }],
      b: [{ channel: 'tc', outcome: 'passed' }],
    }))
    expect(r.status).toBe('passed')
    expect(r.perWp.every((v) => v.proven)).toBe(true)
  })
  it('a skipped channel → blocked, missingChannels lists it', () => {
    const r = evaluateReleaseGate([wp('a')], ev({ a: [{ channel: 'tc', outcome: 'passed' }, { channel: 'conformance', outcome: 'skipped' }] }))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0].missingChannels).toEqual(['conformance'])
  })
  it('no evidence row → unverifiable → blocked (design_ui trap)', () => {
    const r = evaluateReleaseGate([wp('a')], ev({}))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0].unverifiable).toBe(true)
    expect(r.perWp[0].proven).toBe(false)
  })
  it('evidence without tc:passed → blocked (tc missing)', () => {
    const r = evaluateReleaseGate([wp('a')], ev({ a: [{ channel: 'security', outcome: 'passed' }] }))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0].missingChannels).toContain('tc')
  })
  it('perWp is sorted by wpId (deterministic)', () => {
    const r = evaluateReleaseGate([wp('b'), wp('a')], ev({ a: [{ channel: 'tc', outcome: 'passed' }], b: [{ channel: 'tc', outcome: 'passed' }] }))
    expect(r.perWp.map((v) => v.wpId)).toEqual(['a', 'b'])
  })
})

describe('allWpDone / doneSetVersion', () => {
  const states = (m: Record<string, { toState: string; seq: number }>) => new Map(Object.entries(m))
  it('allWpDone true only when every WP DONE', () => {
    expect(allWpDone([wp('a'), wp('b')], states({ a: { toState: 'DONE', seq: 1 }, b: { toState: 'DONE', seq: 2 } }))).toBe(true)
    expect(allWpDone([wp('a'), wp('b')], states({ a: { toState: 'DONE', seq: 1 }, b: { toState: 'ESCALATED', seq: 2 } }))).toBe(false)
    expect(allWpDone([wp('a')], states({}))).toBe(false)
  })
  it('doneSetVersion is deterministic and changes when a DONE transition changes', () => {
    const v1 = doneSetVersion(states({ a: { toState: 'DONE', seq: 1 }, b: { toState: 'DONE', seq: 2 } }))
    const v2 = doneSetVersion(states({ a: { toState: 'DONE', seq: 1 }, b: { toState: 'DONE', seq: 2 } }))
    const v3 = doneSetVersion(states({ a: { toState: 'DONE', seq: 1 }, b: { toState: 'DONE', seq: 9 } }))
    expect(v1).toBe(v2)
    expect(v1).not.toBe(v3)
  })
})

/**
 * **역할에 맞는 증거를 증명으로 인정한다**(S5.2a).
 *
 * `proven` 이 모든 WP 에 `tc: passed` 를 요구하면 **security WP 는 영원히 미증명**이다 —
 * 돌릴 테스트가 없기 때문이다. 그러면 S5.2a 가 증거를 남기게 만들어도 게이트는 여전히 막고,
 * `MANAGER_DEPLOY_GATE_STRICT` 를 못 뒤집는 상태가 그대로 남는다.
 *
 * 요구 채널은 **WP 가 무엇을 내기로 한 것인가**로 정한다(`owningRole`).
 */
describe('evaluateReleaseGate — 역할별 요구 증거(S5.2a)', () => {
  const secWp = (id: string) =>
    ({ id, storyId: 's', owningRole: 'security', acceptanceCriteria: [], risk: 'MEDIUM' }) as never

  it('security WP 는 security:passed 로 증명된다(tc 를 요구하지 않는다)', () => {
    const r = evaluateReleaseGate([secWp('s1')], ev({ s1: [{ channel: 'security', outcome: 'passed' }] }))
    expect(r.status).toBe('passed')
    expect(r.perWp[0]!.proven).toBe(true)
    expect(r.perWp[0]!.missingChannels).toEqual([])
  })

  it('security WP 가 tc 만 있으면 증명되지 않는다(엉뚱한 증거)', () => {
    const r = evaluateReleaseGate([secWp('s1')], ev({ s1: [{ channel: 'tc', outcome: 'passed' }] }))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.missingChannels).toEqual(['security'])
  })

  it('security WP 의 security 채널이 skipped 면 증명되지 않는다', () => {
    const r = evaluateReleaseGate([secWp('s1')], ev({ s1: [{ channel: 'security', outcome: 'skipped' }] }))
    expect(r.status).toBe('blocked')
  })

  it('developer WP 는 여전히 tc 를 요구한다(게이트를 약화시키지 않는다)', () => {
    const r = evaluateReleaseGate([wp('a')], ev({ a: [{ channel: 'security', outcome: 'passed' }] }))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.missingChannels).toEqual(['tc'])
  })

  it('섞인 그래프 — 각자 자기 증거를 갖추면 통과한다', () => {
    const r = evaluateReleaseGate([wp('a'), secWp('s1')], ev({
      a: [{ channel: 'tc', outcome: 'passed' }],
      s1: [{ channel: 'security', outcome: 'passed' }],
    }))
    expect(r.status).toBe('passed')
  })

  /**
   * `design_ui` 는 **아직 자기검증이 없다**(S5.2b). 증거를 남기지 못하므로 여전히
   * `unverifiable` 이어야 한다 — 여기서 미리 통과시키면 그것이 무음 통과다.
   */
  it('designer WP 는 아직 증거가 없어 unverifiable 이다(S5.2b 전까지)', () => {
    const dsn = ({ id: 'd1', storyId: 's', owningRole: 'designer', acceptanceCriteria: [], risk: 'MEDIUM' }) as never
    const r = evaluateReleaseGate([dsn], ev({}))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.unverifiable).toBe(true)
  })

  /**
   * 위 테스트는 **증거가 비면 역할 맵을 보기 전에 단락**하므로 맵에 designer 를 넣어도 초록이다 —
   * 그것만으로는 "designer 는 아직 맵에 없다"를 고정하지 못한다. 증거를 주고 요구 채널을 직접 본다.
   */
  it('designer 는 역할 맵에 없어 여전히 tc 를 요구한다(S5.2b 전까지 완화 금지)', () => {
    const dsn = ({ id: 'd1', storyId: 's', owningRole: 'designer', acceptanceCriteria: [], risk: 'MEDIUM' }) as never
    const r = evaluateReleaseGate([dsn], ev({ d1: [{ channel: 'security', outcome: 'passed' }] }))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.missingChannels).toEqual(['tc'])
  })

  it('미지 역할(오타·LLM 창작)도 tc 를 요구한다(fail-closed)', () => {
    const odd = ({ id: 'x1', storyId: 's', owningRole: 'Security', acceptanceCriteria: [], risk: 'MEDIUM' }) as never
    const r = evaluateReleaseGate([odd], ev({ x1: [{ channel: 'security', outcome: 'passed' }] }))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.missingChannels).toEqual(['tc'])
  })
})
