import { describe, it, expect } from 'vitest'
import { evaluateDeployGate, PROJECTLESS_SENTINEL, ReleaseDeployGate } from './deploy-gate.js'

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

// 좁은 stub — 실제 repo 대신 필요한 메서드만
type GateStub = { latestGateByProject: (p: string) => Promise<{ status: 'passed' | 'blocked'; workflowId: string } | null> }
type DecStub = { hasApprovedReleaseSignoff: (wf: string) => Promise<boolean> }
function make(gate: GateStub, dec: DecStub): ReleaseDeployGate {
  return new ReleaseDeployGate(gate as never, dec as never)
}

describe('ReleaseDeployGate.checkDeploy (구현체 2케이스 + 위임)', () => {
  const gateOf = (g: { status: 'passed' | 'blocked'; workflowId: string } | null) => ({ latestGateByProject: async () => g })
  const decOf = (b: boolean) => ({ hasApprovedReleaseSignoff: async () => b })

  it('projectId undefined → 허용(조회 안 함)', async () => {
    let called = false
    const g = make({ latestGateByProject: async () => { called = true; return null } }, decOf(false))
    expect(await g.checkDeploy(undefined)).toEqual({ allowed: true })
    expect(called).toBe(false)
  })
  it('projectId "default"(sentinel) → 허용(조회 안 함)', async () => {
    let called = false
    const g = make({ latestGateByProject: async () => { called = true; return null } }, decOf(false))
    expect(await g.checkDeploy('default')).toEqual({ allowed: true })
    expect(called).toBe(false)
  })
  it('게이트 조회 throw → 허용(fail-open)', async () => {
    const g = make({ latestGateByProject: async () => { throw new Error('db down') } }, decOf(false))
    expect(await g.checkDeploy('proj-x')).toEqual({ allowed: true })
  })
  it('blocked + 사인오프 조회 throw → 허용(fail-open)', async () => {
    const g = make(gateOf({ status: 'blocked', workflowId: 'wf-1' }), { hasApprovedReleaseSignoff: async () => { throw new Error('db') } })
    expect(await g.checkDeploy('proj-x')).toEqual({ allowed: true })
  })
  it('passed → 허용(사인오프 조회 안 함)', async () => {
    let decCalled = false
    const g = make(gateOf({ status: 'passed', workflowId: 'wf-1' }), { hasApprovedReleaseSignoff: async () => { decCalled = true; return false } })
    expect(await g.checkDeploy('proj-x')).toEqual({ allowed: true })
    expect(decCalled).toBe(false)
  })
  it('blocked + 사인오프 있음 → 허용', async () => {
    const g = make(gateOf({ status: 'blocked', workflowId: 'wf-1' }), decOf(true))
    expect(await g.checkDeploy('proj-x')).toEqual({ allowed: true })
  })
  it('blocked + 사인오프 없음 → 차단', async () => {
    const g = make(gateOf({ status: 'blocked', workflowId: 'wf-9' }), decOf(false))
    const v = await g.checkDeploy('proj-x')
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('wf-9')
  })
})

describe('G6 deploy-gate strict 모드', () => {
  const gateOf = (g: { status: 'passed' | 'blocked'; workflowId: string } | null) => ({ latestGateByProject: async () => g })
  const decOf = (b: boolean) => ({ hasApprovedReleaseSignoff: async () => b })
  const makeStrict = (gate: GateStub, dec: DecStub): ReleaseDeployGate =>
    new ReleaseDeployGate(gate as never, dec as never, true)

  it('evaluateDeployGate: 게이트 null + strict → 차단', () => {
    const v = evaluateDeployGate({ gate: null, hasApprovedSignoff: false, strict: true })
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('strict')
  })
  it('evaluateDeployGate: 게이트 null + non-strict → 허용(회귀 0)', () => {
    expect(evaluateDeployGate({ gate: null, hasApprovedSignoff: false, strict: false })).toEqual({ allowed: true })
  })
  it('checkDeploy: projectless(undefined·default) + strict → 차단', async () => {
    const g = makeStrict(gateOf(null), decOf(false))
    expect((await g.checkDeploy(undefined)).allowed).toBe(false)
    expect((await g.checkDeploy('default')).allowed).toBe(false)
  })
  it('checkDeploy: 게이트 부재(null) + strict → 차단', async () => {
    const g = makeStrict(gateOf(null), decOf(false))
    expect((await g.checkDeploy('proj-x')).allowed).toBe(false)
  })
  it('checkDeploy: 조회 throw + strict → 차단(fail-closed)', async () => {
    const g = makeStrict({ latestGateByProject: async () => { throw new Error('db down') } }, decOf(false))
    expect((await g.checkDeploy('proj-x')).allowed).toBe(false)
  })
  it('checkDeploy: passed + strict → 여전히 허용(strict는 부재/오류만 차단)', async () => {
    const g = makeStrict(gateOf({ status: 'passed', workflowId: 'wf-1' }), decOf(false))
    expect((await g.checkDeploy('proj-x')).allowed).toBe(true)
  })
  it('checkDeploy: blocked + 사인오프 + strict → 허용', async () => {
    const g = makeStrict(gateOf({ status: 'blocked', workflowId: 'wf-1' }), decOf(true))
    expect((await g.checkDeploy('proj-x')).allowed).toBe(true)
  })
})
