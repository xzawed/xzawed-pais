import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { judgePrimaryResult, verifyWp, type VerifyDeps } from './verify.js'

/**
 * **`security_audit` WP 자기검증**(S5.2a / 결함 F4 · 수용 기준 L2-3).
 *
 * 이전에는 `judgePrimaryResult('security_audit', …)` 가 pass-through 였고
 * `planVerificationChecks('security_audit')` 가 `[]` 라 **즉시 통과하며 증거를 한 행도 안 남겼다.**
 * 그 결과 릴리스 게이트가 그 WP 를 `unverifiable` 로 보고 워크플로 전체를 영구 차단했다 —
 * `MANAGER_DEPLOY_GATE_STRICT` 를 못 뒤집던 이유가 이것이다.
 *
 * **WP 의 산출물 자체가 감사 결과다.** 그러니 자기검증은 "감사가 실제로 돌았는가"다.
 * 취약점을 찾은 것은 성공한 감사이지 실패가 아니다 — 발견을 막는 것은 *코드를 낸 WP* 의
 * security 채널 몫이고, 이 WP 의 몫은 **증거 있는 감사**를 내는 것이다.
 */

const AUDITED = { static: { requested: 3, scanned: 3 }, deps: { status: 'ok' as const } }

const wp = {
  id: 'wp-sec', storyId: 's1', owningRole: 'security',
  acceptanceCriteria: ['AC1'], risk: 'MEDIUM',
} as unknown as WorkPackage

function deps(over: Partial<VerifyDeps> = {}): VerifyDeps {
  return {
    handlers: {}, buildInput: () => ({ context: {}, severity: 'low', projectPath: '/abs/ws', artifacts: [] }),
    workflowId: 'wf-1', attempt: 0,
    userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } as never,
    ...over,
  }
}

describe('judgePrimaryResult(security_audit) — 증거 없이 통과하지 않는다', () => {
  test('감사가 실제로 돌았으면 통과한다', () => {
    expect(judgePrimaryResult('security_audit', { issues: [], auditable: AUDITED })).toEqual({ ok: true })
  })

  test('취약점을 찾은 것은 성공한 감사다(발견은 이 WP 의 실패가 아니다)', () => {
    const found = { issues: [{ severity: 'critical', source: 'static' }], auditable: AUDITED }
    expect(judgePrimaryResult('security_audit', found)).toEqual({ ok: true })
  })

  test('결과 파싱에 실패하면 통과하지 않는다', () => {
    const v = judgePrimaryResult('security_audit', { nope: 1 })
    expect(v.ok).toBe(false)
  })

  test('auditable 이 없으면 통과하지 않는다(무실행이 통과로 영속되던 자리)', () => {
    const v = judgePrimaryResult('security_audit', { issues: [] })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/감사/)
  })

  test('요청은 있는데 0건 스캔이면 통과하지 않는다', () => {
    const v = judgePrimaryResult('security_audit', {
      issues: [], auditable: { static: { requested: 5, scanned: 0 }, deps: { status: 'ok' } },
    })
    expect(v.ok).toBe(false)
  })

  test('집계가 불완전하면 통과하지 않는다', () => {
    expect(judgePrimaryResult('security_audit', { issues: [], auditable: { deps: { status: 'ok' } } }).ok).toBe(false)
    expect(judgePrimaryResult('security_audit', {
      issues: [], auditable: { static: { requested: 3 }, deps: { status: 'ok' } },
    }).ok).toBe(false)
  })

  test('집계 수치가 비정상이면 통과하지 않는다', () => {
    expect(judgePrimaryResult('security_audit', {
      issues: [], auditable: { static: { requested: -1, scanned: 0 }, deps: { status: 'ok' } },
    }).ok).toBe(false)
  })

  /**
   * **`judgeAuditable` 과 답하는 질문이 다르다.** 그쪽은 "이 결과를 *남의 코드* 게이트 신호로
   * 믿어도 되는가"라 `deps.unavailable` 하나로 불능이지만, 여기는 "이 WP 가 감사 작업을 했는가"다 —
   * static 이 실제로 스캔했다면 증거는 존재한다.
   */
  test('static 이 스캔했으면 deps 불가만으로 실패시키지 않는다', () => {
    expect(judgePrimaryResult('security_audit', {
      issues: [], auditable: { static: { requested: 2, scanned: 2 }, deps: { status: 'unavailable' } },
    })).toEqual({ ok: true })
  })
})

describe('verifyWp(security_audit) — 증거를 남긴다', () => {
  test('통과 시 security 채널 증거를 기록한다(게이트가 볼 수 있어야 한다)', async () => {
    const recordOutcome = vi.fn()
    const v = await verifyWp('security_audit', wp, { issues: [], auditable: AUDITED }, deps({ recordOutcome }))
    expect(v.ok).toBe(true)
    expect(recordOutcome).toHaveBeenCalledWith('security', 'passed')
  })

  test('실패 시에는 증거를 남기지 않는다', async () => {
    const recordOutcome = vi.fn()
    const v = await verifyWp('security_audit', wp, { issues: [] }, deps({ recordOutcome }))
    expect(v.ok).toBe(false)
    expect(recordOutcome).not.toHaveBeenCalled()
  })

  test('다른 도구의 증거 기록에는 영향이 없다(회귀 0)', async () => {
    const recordOutcome = vi.fn()
    await verifyWp('run_tests', wp, { success: true, passed: 3, failed: 0 }, deps({ recordOutcome }))
    expect(recordOutcome).toHaveBeenCalledWith('tc', 'passed')
    expect(recordOutcome).not.toHaveBeenCalledWith('security', 'passed')
  })
})

/**
 * **프로덕션이 실제로 내는 모양으로 건다.**
 *
 * `buildWorkerInput` 은 **모든 WP 에 `artifacts: []` 를 하드코딩**한다(`worker.ts:116` — WP 의
 * `inputs`/`outputs` 가 아직 안 채워지는 F7/S6.3 때문이다). 그래서 static 은 `requested: 0` 이 되고,
 * **의존성 감사는 `projectPath` 기준이라 artifacts 와 무관하게 실제로 돈다**(`security.ts:52`).
 *
 * 여기서 `requested === 0` 만 보고 실패시키면 **실제로 수행된 deps 감사 증거를 버리고**
 * security WP 가 영원히 완료되지 않는다 — 원래 결함(DONE 은 되고 게이트만 막힘)보다 나쁘다.
 * 증거의 기준은 요청 건수가 아니라 **무언가가 실제로 감사됐는가**다.
 */
describe('judgeSecurityAuditWp — 프로덕션 형태(artifacts 미배선)', () => {
  test('static 0건이어도 deps 가 실제로 돌았으면 증거가 있다', () => {
    const v = judgePrimaryResult('security_audit', {
      issues: [],
      auditable: { static: { requested: 0, scanned: 0 }, deps: { status: 'ok' } },
    })
    expect(v, 'deps 감사 증거를 버렸다').toEqual({ ok: true })
  })

  test('deps 가 못 돌았고 static 도 0건이면 아무것도 감사되지 않았다', () => {
    const v = judgePrimaryResult('security_audit', {
      issues: [],
      auditable: { static: { requested: 0, scanned: 0 }, deps: { status: 'not_applicable' } },
    })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/감사/)
  })

  test('deps 불가 + static 0건도 증거 없음이다', () => {
    const v = judgePrimaryResult('security_audit', {
      issues: [],
      auditable: { static: { requested: 0, scanned: 0 }, deps: { status: 'unavailable' } },
    })
    expect(v.ok).toBe(false)
  })

  test('static 이 실제로 스캔했으면 deps 가 not_applicable 이어도 증거가 있다', () => {
    expect(judgePrimaryResult('security_audit', {
      issues: [],
      auditable: { static: { requested: 2, scanned: 2 }, deps: { status: 'not_applicable' } },
    })).toEqual({ ok: true })
  })

  test('요청은 있는데 하나도 못 스캔했고 deps 도 못 돌면 불능이다', () => {
    const v = judgePrimaryResult('security_audit', {
      issues: [],
      auditable: { static: { requested: 5, scanned: 0 }, deps: { status: 'unavailable' } },
    })
    expect(v.ok).toBe(false)
  })
})
