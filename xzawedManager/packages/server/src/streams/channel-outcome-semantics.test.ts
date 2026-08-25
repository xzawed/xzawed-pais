import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { verifyWp, type VerifyDeps } from './verify.js'
import { evaluateReleaseGate } from './release-gate.js'
import type { ChannelOutcome } from '../db/release-gate.types.js'

/**
 * **채널 결과 의미론 — 비대상과 미증명의 분리**(S5.3a).
 *
 * 검증 채널 5종(conformance·impact·property·mutation·security)은 **전부 기본 off** 인데,
 * 꺼져 있을 때도 결과를 기록했다. 그 결과가 `skipped` 하나뿐이었고 릴리스 게이트는
 * `passed` 가 아닌 것을 전부 미증명으로 셌으므로, **게이트를 켜면 테스트를 통과한 WP 조차
 * "미증명 채널 5개"로 영구 차단**됐다.
 *
 * 이 파일이 메우는 구멍은 두 가지다.
 *
 * 1. **생산자를 아무도 안 봤다.** 기존 게이트 테스트는 outcome 을 손으로 만들어
 *    `evaluateReleaseGate` 에 직접 넣는다 — `verify.ts` 가 *실제로* 무엇을 기록하는지 확인한
 *    테스트가 0개였다. 그래서 5곳의 기록값을 바꿔도 1466건이 전부 초록이었다.
 * 2. **왕복을 아무도 안 봤다.** 생산자 출력이 게이트를 통과하는지를 한 번에 잇는 테스트가 없었다.
 */

const wp = (over: Partial<WorkPackage> = {}): WorkPackage => ({
  id: 'wp-a', storyId: 's1', owningRole: 'developer', oracleRef: null,
  acceptanceCriteria: ['ac1'], dependencies: [], attributionCounters: {}, status: 'DRAFTED',
  risk: 'MEDIUM', ...over,
} as unknown as WorkPackage)

const uc = { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } as never
const okHandler = () => ({ execute: vi.fn().mockResolvedValue({ success: true, failed: 0, passed: 3 }) })

/** 기본 태세 그대로 — 채널 플래그를 **하나도 주지 않는다**(프로덕션 기본값이 그렇다). */
function defaultDeps(recordOutcome: VerifyDeps['recordOutcome']): VerifyDeps {
  return {
    handlers: { build_project: okHandler() as never, run_tests: okHandler() as never },
    buildInput: () => ({ projectPath: '/abs/ws' }),
    userContext: uc, workflowId: 'wf-1', attempt: 0, recordOutcome,
  }
}

describe('생산자 — 꺼진 채널은 not_applicable 을 기록한다(미증명이 아니다)', () => {
  test('기본 태세의 develop_code: tc 만 passed, 채널 5종은 전부 not_applicable', async () => {
    const rec = vi.fn()
    const v = await verifyWp('develop_code', wp(), { artifacts: [] }, defaultDeps(rec))
    expect(v).toEqual({ ok: true })

    const outcomes = rec.mock.calls.map(([channel, outcome]) => ({ channel, outcome }))
    expect(outcomes).toContainEqual({ channel: 'tc', outcome: 'passed' })
    for (const ch of ['conformance', 'impact', 'property', 'mutation', 'security']) {
      expect(outcomes, `${ch} 가 비대상으로 기록되지 않았다`).toContainEqual({ channel: ch, outcome: 'not_applicable' })
    }
  })

  test('기본 태세에서는 skipped 를 하나도 기록하지 않는다', async () => {
    const rec = vi.fn()
    await verifyWp('develop_code', wp(), { artifacts: [] }, defaultDeps(rec))
    const skipped = rec.mock.calls.filter(([, outcome]) => outcome === 'skipped')
    expect(skipped, `skipped 로 기록된 채널: ${JSON.stringify(skipped)}`).toEqual([])
  })

  /**
   * mutation 은 켜져 있어도 `wp.risk` 가 floor 미만이면 돌지 않는다 — **설계상 범위 밖**이지
   * 증명 실패가 아니다. 계획서가 `S5.3` 의 수용 기준으로 명시한 자리다.
   */
  test('mutation 이 켜졌어도 등급 미달 WP 는 not_applicable 이다', async () => {
    const rec = vi.fn()
    const deps = { ...defaultDeps(rec), mutationEnabled: true, mutationMinRisk: 'HIGH' as const }
    await verifyWp('develop_code', wp({ risk: 'MEDIUM' } as Partial<WorkPackage>), { artifacts: [] }, deps)
    const outcomes = rec.mock.calls.map(([channel, outcome]) => ({ channel, outcome }))
    expect(outcomes).toContainEqual({ channel: 'mutation', outcome: 'not_applicable' })
  })
})

/**
 * **켜진 채널은 비대상이 아니다.**
 *
 * 여기가 S5.3a 가 한 번 **게이트를 약화시킨** 자리다. 운영자가 채널을 켰는데 증명이 안 나온
 * 경우까지 `not_applicable` 로 묶으면, "증명을 요구해 놓고 증명 없이 통과"가 된다.
 * 비대상은 **끄거나 범위 밖일 때**뿐이다.
 */
describe('생산자 — 켜진 채널이 증명하지 못하면 skipped(차단)이다', () => {
  /** 스토어는 주입됐지만 이 story 에 **승인된 오라클이 하나도 없다** — 실제로 흔한 상태다. */
  const store = {
    approvedOracleForStory: vi.fn().mockResolvedValue(null),
    approvedGoldenRefsForStory: vi.fn().mockResolvedValue(null),
    approvedInvariantsForStory: vi.fn().mockResolvedValue(null),
  } as never

  test('conformance 가 켜졌는데 승인 베이스라인이 없으면 skipped 다', async () => {
    const rec = vi.fn()
    const deps = { ...defaultDeps(rec), conformanceEnabled: true, oracleStore: store }
    await verifyWp('develop_code', wp(), { artifacts: [] }, deps)
    const outcomes = rec.mock.calls.map(([channel, outcome]) => ({ channel, outcome }))
    expect(outcomes).toContainEqual({ channel: 'conformance', outcome: 'skipped' })
  })

  test('그 skipped 는 릴리스 게이트를 막는다', async () => {
    const rec = vi.fn()
    const w = wp()
    const deps = { ...defaultDeps(rec), conformanceEnabled: true, oracleStore: store }
    await verifyWp('develop_code', w, { artifacts: [] }, deps)
    const produced = rec.mock.calls.map(([channel, outcome]) => ({ channel, outcome })) as ChannelOutcome[]
    const r = evaluateReleaseGate([w], new Map([[w.id, produced]]))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.missingChannels).toContain('conformance')
  })

  /** 플래그는 켰는데 오라클 스토어가 없다 — 구성 오류다. 조용히 통과시키지 않는다. */
  test('채널이 켜졌는데 오라클 스토어가 없으면 skipped 다(구성 오류)', async () => {
    const rec = vi.fn()
    const deps = { ...defaultDeps(rec), conformanceEnabled: true }
    await verifyWp('develop_code', wp(), { artifacts: [] }, deps)
    const outcomes = rec.mock.calls.map(([channel, outcome]) => ({ channel, outcome }))
    expect(outcomes).toContainEqual({ channel: 'conformance', outcome: 'skipped' })
  })
})

/**
 * **왕복 — 생산자 출력을 그대로 게이트에 넣는다.**
 *
 * 손으로 만든 outcome 을 넣으면 생산자가 무엇을 기록하든 초록이다. 그것이 이 결함이
 * 1466건의 초록 아래 숨어 있던 이유다.
 */
describe('왕복 — 기본 태세에서 릴리스 게이트가 통과한다(데드락 해소)', () => {
  test('테스트를 통과한 WP 가 꺼진 채널 때문에 차단되지 않는다', async () => {
    const rec = vi.fn()
    const w = wp()
    await verifyWp('develop_code', w, { artifacts: [] }, defaultDeps(rec))
    const produced = rec.mock.calls.map(([channel, outcome]) => ({ channel, outcome })) as ChannelOutcome[]

    const r = evaluateReleaseGate([w], new Map([[w.id, produced]]))
    expect(r.status, `차단 사유: ${r.blockingReasons.join(' / ')}`).toBe('passed')
    expect(r.perWp[0]!.proven).toBe(true)
    expect(r.perWp[0]!.missingChannels).toEqual([])
  })
})

describe('게이트 — skipped 는 여전히 막는다(fail-closed 유지)', () => {
  test('not_applicable 은 미증명이 아니다', () => {
    const w = wp()
    const r = evaluateReleaseGate([w], new Map([[w.id, [
      { channel: 'tc', outcome: 'passed' },
      { channel: 'security', outcome: 'not_applicable' },
    ] as ChannelOutcome[]]]))
    expect(r.status).toBe('passed')
    expect(r.perWp[0]!.missingChannels).toEqual([])
  })

  /**
   * `skipped` 는 **분류하지 않은 것의 기본값**으로 남는다. 새 채널이 "왜 비대상인지" 밝히지
   * 않으면 통과가 아니라 차단이다 — 모르는 것을 느슨하게 열지 않는다.
   */
  test('skipped 는 미증명으로 남아 게이트를 막는다', () => {
    const w = wp()
    const r = evaluateReleaseGate([w], new Map([[w.id, [
      { channel: 'tc', outcome: 'passed' },
      { channel: 'security', outcome: 'skipped' },
    ] as ChannelOutcome[]]]))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.missingChannels).toEqual(['security'])
  })

  test('not_applicable 이 요구 채널의 부재를 덮지 않는다', () => {
    const w = wp()
    const r = evaluateReleaseGate([w], new Map([[w.id, [
      { channel: 'security', outcome: 'not_applicable' },
      { channel: 'mutation', outcome: 'not_applicable' },
    ] as ChannelOutcome[]]]))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.missingChannels).toEqual(['tc'])
  })

  /**
   * 게이트는 `!== 'passed' && !== 'not_applicable'` 로 판정한다. `=== 'skipped'` 로 좁혀 세면
   * **미지의 종류가 조용히 통과**하므로, 새 outcome 종류를 추가하고 게이트를 안 고치면
   * 통과가 아니라 차단이 되어야 한다.
   */
  test('미지의 outcome 종류는 조용히 통과하지 않는다(fail-closed 기본값)', () => {
    const w = wp()
    const r = evaluateReleaseGate([w], new Map([[w.id, [
      { channel: 'tc', outcome: 'passed' },
      { channel: 'security', outcome: 'deferred' },
    ] as unknown as ChannelOutcome[]]]))
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.missingChannels).toEqual(['security'])
  })

  test('증거가 아예 없으면 여전히 unverifiable 이다', () => {
    const w = wp()
    const r = evaluateReleaseGate([w], new Map())
    expect(r.status).toBe('blocked')
    expect(r.perWp[0]!.unverifiable).toBe(true)
  })
})
