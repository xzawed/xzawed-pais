import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { verifyWp, type VerifyDeps } from './verify.js'

const wp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'], risk: 'MEDIUM' } as unknown as WorkPackage
const devResult = { artifacts: ['src/a.ts'] }
const okBuilder = { execute: vi.fn().mockResolvedValue({ success: true }) }
const okTester = { execute: vi.fn().mockResolvedValue({ success: true, passed: 1, failed: 0 }) }
const sec = (issues: unknown[]) => ({ execute: vi.fn().mockResolvedValue({ issues }) })

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

  test('절대경로 artifact는 security_audit 호출 전 필터된다', async () => {
    const securityAudit = sec([])
    await verifyWp('develop_code', wp, { artifacts: ['src/a.ts', '/etc/passwd', 'C:\\windows\\x.ts', '../escape.ts'] },
      baseDeps({ securityEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, security_audit: securityAudit } }))
    expect(securityAudit.execute).toHaveBeenCalledTimes(1)
    const passedArtifacts = (securityAudit.execute.mock.calls[0]?.[0] as { artifacts?: string[] })?.artifacts
    expect(passedArtifacts).toEqual(['src/a.ts'])
  })
})
