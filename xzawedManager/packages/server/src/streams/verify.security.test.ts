import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { verifyWp, type VerifyDeps } from './verify.js'

const wp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'], risk: 'MEDIUM' } as unknown as WorkPackage
const devResult = { artifacts: ['src/a.ts'] }
const okBuilder = { execute: vi.fn().mockResolvedValue({ success: true }) }
const okTester = { execute: vi.fn().mockResolvedValue({ success: true, passed: 1, failed: 0 }) }
/** S5.1: 감사 가능 비트가 없으면 채널이 fail-closed 로 막는다 — 기본 픽스처는 "정상 감사" 상태다. */
const AUDITED = { static: { requested: 1, scanned: 1 }, deps: { status: 'ok' as const } }
const sec = (issues: unknown[], auditable: unknown = AUDITED) =>
  ({ execute: vi.fn().mockResolvedValue({ issues, auditable }) })
/** auditable 키 자체를 빼는 변형 — `sec(x, undefined)` 는 기본 파라미터가 삼켜 AUDITED 가 된다. */
const secNoAuditable = (issues: unknown[]) => ({ execute: vi.fn().mockResolvedValue({ issues }) })

function baseDeps(over: Partial<VerifyDeps>): VerifyDeps {
  return {
    handlers: {}, buildInput: () => ({ context: {}, severity: 'low', projectPath: '/abs/ws', artifacts: [] }),
    workflowId: 'wf-1', attempt: 0,
    userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } as never,
    ...over,
  }
}

describe('verifyWp security 채널', () => {
  beforeEach(() => { vi.clearAllMocks() })

  test('securityEnabled off → 미동작(security_audit 미호출)', async () => {
    const securityAudit = sec([{ id: 'x', severity: 'high', source: 'static', category: 'c', file: 'a.ts', description: 'd', suggestion: 's' }])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: false, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(true)
    expect(securityAudit.execute).not.toHaveBeenCalled()
  })

  test('static high finding → 차단(blocking)', async () => {
    const securityAudit = sec([{ id: 'x', severity: 'high', source: 'static', category: 'injection', file: 'a.ts', description: 'd', suggestion: 's' }])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(false)
  })

  test('deps critical finding → 차단', async () => {
    const securityAudit = sec([{ id: 'DEP-x', severity: 'critical', source: 'deps', category: 'dependency', file: 'package.json', description: 'd', suggestion: 's' }])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(false)
  })

  test('llm high finding → 통과(게이트 제외·N6)', async () => {
    const securityAudit = sec([{ id: 'CL-1', severity: 'high', source: 'llm', category: 'injection', file: 'a.ts', description: 'd', suggestion: 's' }])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(true)
  })

  test('static medium finding + floor high → 통과', async () => {
    const securityAudit = sec([{ id: 'x', severity: 'medium', source: 'static', category: 'c', file: 'a.ts', description: 'd', suggestion: 's' }])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, securityMinSeverity: 'high', handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(true)
  })

  test('floor medium이면 static medium도 차단', async () => {
    const securityAudit = sec([{ id: 'x', severity: 'medium', source: 'static', category: 'c', file: 'a.ts', description: 'd', suggestion: 's' }])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, securityMinSeverity: 'medium', handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(false)
  })

  test('findings 0건 → 통과', async () => {
    const securityAudit = sec([])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(true)
  })

  test('security_audit 핸들러 부재 → fail-closed', async () => {
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester } }))
    expect(v.ok).toBe(false)
  })

  test('결과 파싱 실패(source 부재) → fail-closed', async () => {
    const securityAudit = sec([{ id: 'x', severity: 'high', category: 'c', file: 'a.ts', description: 'd', suggestion: 's' }])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(false)
  })

  test('에이전트 throw → fail-closed', async () => {
    const securityAudit = { execute: vi.fn().mockRejectedValue(new Error('boom')) }
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(false)
  })

  test('mixed static:medium + llm:high, floor high → 통과(소스∧severity 필터 합성)', async () => {
    const securityAudit = sec([
      { id: 'a', severity: 'medium', source: 'static', category: 'c', file: 'a.ts', description: 'd', suggestion: 's' },
      { id: 'b', severity: 'high', source: 'llm', category: 'c', file: 'a.ts', description: 'd', suggestion: 's' },
    ])
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, securityMinSeverity: 'high', handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(true)
  })

  test('절대경로·traversal artifact는 security_audit 호출 전 필터된다', async () => {
    // 플랫폼 무관 케이스만 사용: '/etc/passwd'는 POSIX·win32 모두 isAbsolute=true, '../escape.ts'는
    // '..' 포함으로 모든 플랫폼에서 드롭. (win32 'C:\\..' 류는 Linux CI에서 isAbsolute=false라 테스트 불안정 —
    // 프로덕션은 Manager·security 에이전트가 같은 플랫폼(Docker/Linux)에서 같은 path.isAbsolute를 쓰므로 정합.)
    const securityAudit = sec([])
    await verifyWp('develop_code', wp, { artifacts: ['src/a.ts', '/etc/passwd', '../escape.ts'] },
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(securityAudit.execute).toHaveBeenCalledTimes(1)
    const passedArtifacts = (securityAudit.execute.mock.calls[0]?.[0] as { artifacts?: string[] })?.artifacts
    expect(passedArtifacts).toEqual(['src/a.ts'])
  })
  /**
   * **드롭이 아니라 상대화다**(S5.1). Developer 는 workspaceRoot 하위 절대경로를 낼 수 있고
   * (applyChange 가 허용한다) 그것은 정상 산출물이다. 드롭해서 감사에서 빼면 커버리지가 줄고,
   * 그 드롭을 감사 불능으로 세면 **정상 WP 가 채널에 영구 차단**된다.
   */
  test('workspaceRoot 하위 절대경로는 상대화해서 감사한다(차단하지 않는다)', async () => {
    const securityAudit = sec([])
    const v = await verifyWp('develop_code', wp, { artifacts: ['/abs/ws/src/a.ts', 'src/b.ts'] },
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    const sent = (securityAudit.execute.mock.calls[0]?.[0] as { artifacts?: string[] })?.artifacts
    expect(sent).toEqual(['src/a.ts', 'src/b.ts'])
    expect(v.ok, '정상 산출물이 채널을 막았다').toBe(true)
  })

  test('workspaceRoot 밖 경로가 섞이면 감사 불능이다(집계를 믿을 수 없다)', async () => {
    const securityAudit = sec([])
    const v = await verifyWp('develop_code', wp, { artifacts: ['src/a.ts', '/etc/passwd'] },
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/감사 불능/)
  })

})

/**
 * **배선 테스트**(S5.1). 순수 `judgeAuditable` 만 테스트하면 그것을 `runSecurityCheck` 에서
 * 부르는 것을 빼먹어도 초록이다 — 채널이 실제로 막는지를 여기서 본다.
 * 이것이 없으면 S6.2 에서 겪은 "함수는 있는데 호출자가 0곳" 과 같은 상태가 된다.
 */
describe('verifyWp security 채널 — 감사 불능은 통과가 아니다(S5.1)', () => {
  const clean: unknown[] = []

  test('auditable 이 없으면 이슈 0건이어도 통과하지 않는다', async () => {
    const securityAudit = secNoAuditable(clean)
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } as never }))
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/감사 불능/)
  })

  test('요청은 있는데 0건 스캔이면 통과하지 않는다', async () => {
    const securityAudit = sec(clean, { static: { requested: 7, scanned: 0 }, deps: { status: 'ok' } })
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } as never }))
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/7건 요청 중 0건/)
  })

  test('의존성 감사 불가면 통과하지 않는다', async () => {
    const securityAudit = sec(clean, { static: { requested: 1, scanned: 1 }, deps: { status: 'unavailable' } })
    const v = await verifyWp('develop_code', wp, devResult,
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } as never }))
    expect(v.ok).toBe(false)
  })
})
