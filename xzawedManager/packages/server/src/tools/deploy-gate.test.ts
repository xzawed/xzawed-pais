import { describe, it, expect } from 'vitest'
import { evaluateDeployGate, PROJECTLESS_SENTINEL } from './deploy-gate.js'

describe('evaluateDeployGate (순수 4분기)', () => {
  it('게이트 부재(null) → 허용', () => {
    expect(evaluateDeployGate({ gate: null, hasApprovedSignoff: false })).toEqual({ allowed: true })
  })
  it('passed → 허용(사인오프 무관)', () => {
    expect(evaluateDeployGate({ gate: { status: 'passed', workflowId: 'wf-1' }, hasApprovedSignoff: false })).toEqual({ allowed: true })
  })
  it('blocked + 승인 사인오프 → 허용', () => {
    expect(evaluateDeployGate({ gate: { status: 'blocked', workflowId: 'wf-1' }, hasApprovedSignoff: true })).toEqual({ allowed: true })
  })
  it('blocked + 사인오프 없음 → 차단(reason에 workflowId 포함)', () => {
    const v = evaluateDeployGate({ gate: { status: 'blocked', workflowId: 'wf-9' }, hasApprovedSignoff: false })
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('wf-9')
  })
  it('PROJECTLESS_SENTINEL = "default"', () => {
    expect(PROJECTLESS_SENTINEL).toBe('default')
  })
})
