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
