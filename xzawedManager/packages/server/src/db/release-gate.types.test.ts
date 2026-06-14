import { describe, it, expect } from 'vitest'
import {
  RELEASE_GATE_STREAM, WP_VERIFIED_EVENT, GATE_PASSED_EVENT, GATE_BLOCKED_EVENT,
  RELEASE_GATE_ACTOR, type ChannelOutcome,
} from './release-gate.types.js'

describe('release-gate.types', () => {
  it('exposes stable event/stream constants', () => {
    expect(WP_VERIFIED_EVENT).toBe('wp.verified')
    expect(GATE_PASSED_EVENT).toBe('gate.passed')
    expect(GATE_BLOCKED_EVENT).toBe('gate.blocked')
    expect(RELEASE_GATE_STREAM).toBe('manager:release:main')
    expect(RELEASE_GATE_ACTOR).toBe('release-gate')
  })
  it('ChannelOutcome carries channel + outcome', () => {
    const o: ChannelOutcome = { channel: 'tc', outcome: 'passed' }
    expect(o.channel).toBe('tc')
  })
})
