import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { verifyWp, type VerifyDeps } from './verify.js'
import { MUTATION_DIR } from './conformance.js'

const hiWp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'], risk: 'HIGH' } as unknown as WorkPackage
const medWp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'], risk: 'MEDIUM' } as unknown as WorkPackage
const okResult = { success: true, passed: 1, failed: 0 }
const okBuilder = { execute: vi.fn().mockResolvedValue({ success: true }) }
const okTester = { execute: vi.fn().mockResolvedValue({ success: true, passed: 1, failed: 0 }) }
const author = { execute: vi.fn().mockResolvedValue({ artifacts: [`${MUTATION_DIR}/wp-1.test.ts`] }) }
const emptyAuthor = { execute: vi.fn().mockResolvedValue({ artifacts: [] }) }
// derived run_tests(전체 입력) 통과 + mutation run(testFiles=하니스) 실패를 분리하는 스마트 목.
const splitTester = { execute: vi.fn().mockImplementation((input: unknown) => {
  const tf = (input as { testFiles?: string[] }).testFiles
  if (Array.isArray(tf) && tf.some((f) => f.includes(MUTATION_DIR))) return Promise.resolve({ success: false, passed: 0, failed: 1 })
  return Promise.resolve({ success: true, passed: 1, failed: 0 })
}) }

function baseDeps(over: Partial<VerifyDeps>): VerifyDeps {
  return {
    handlers: {}, buildInput: () => ({}), workflowId: 'wf-1', attempt: 0,
    userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } as never,
    ...over,
  }
}

describe('verifyWp mutation θ_risk', () => {
  test('mutationEnabled off → 미동작', async () => {
    const v = await verifyWp('develop_code', hiWp, okResult,
      baseDeps({ mutationEnabled: false, handlers: { build_project: okBuilder, run_tests: okTester, develop_code: author } }))
    expect(v.ok).toBe(true)
    expect(author.execute).not.toHaveBeenCalled()
  })

  test('MEDIUM risk + minRisk HIGH → skip(ok·min-tier 게이트)', async () => {
    const v = await verifyWp('develop_code', medWp, okResult,
      baseDeps({ mutationEnabled: true, mutationMinRisk: 'HIGH', handlers: { build_project: okBuilder, run_tests: okTester, develop_code: author } }))
    expect(v.ok).toBe(true)
  })

  test('HIGH + 하니스 통과(score≥θ) → ok', async () => {
    const v = await verifyWp('develop_code', hiWp, okResult,
      baseDeps({ mutationEnabled: true, mutationMinRisk: 'HIGH', handlers: { build_project: okBuilder, run_tests: okTester, develop_code: author } }))
    expect(v.ok).toBe(true)
  })

  test('HIGH + 하니스 실패(score<θ) → fail(blocking)', async () => {
    const v = await verifyWp('develop_code', hiWp, okResult,
      baseDeps({ mutationEnabled: true, mutationMinRisk: 'HIGH', handlers: { build_project: okBuilder, run_tests: splitTester, develop_code: author } }))
    expect(v.ok).toBe(false)
  })

  test('HIGH + author 미작성 → fail-closed(MUTATION_DIR)', async () => {
    const v = await verifyWp('develop_code', hiWp, okResult,
      baseDeps({ mutationEnabled: true, mutationMinRisk: 'HIGH', handlers: { build_project: okBuilder, run_tests: okTester, develop_code: emptyAuthor } }))
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toContain(MUTATION_DIR)
  })

  test('minRisk MEDIUM이면 MEDIUM WP도 실행', async () => {
    const v = await verifyWp('develop_code', medWp, okResult,
      baseDeps({ mutationEnabled: true, mutationMinRisk: 'MEDIUM', handlers: { build_project: okBuilder, run_tests: okTester, develop_code: author } }))
    expect(v.ok).toBe(true)
    expect(author.execute).toHaveBeenCalled()
  })
})
