import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { verifyWp, type VerifyDeps } from './verify.js'
import { PROPERTY_DIR } from './conformance.js'

const devWp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'] } as unknown as WorkPackage
const invariants = [{ id: 'i1', statement: 'expired tokens rejected', domain: 'token gen', property: 'age>30 => reject', status: 'human_approved' }]
const okResult = { success: true, passed: 1, failed: 0 }
const okBuilder = { execute: vi.fn().mockResolvedValue({ success: true }) }
const okTester = { execute: vi.fn().mockResolvedValue({ success: true, passed: 1, failed: 0 }) }
const failTester = { execute: vi.fn().mockResolvedValue({ success: false, passed: 0, failed: 1 }) }
const author = { execute: vi.fn().mockResolvedValue({ artifacts: [`${PROPERTY_DIR}/wp-1.test.ts`] }) }
const emptyAuthor = { execute: vi.fn().mockResolvedValue({ artifacts: [] }) }

function baseDeps(over: Partial<VerifyDeps>): VerifyDeps {
  return {
    handlers: {}, buildInput: () => ({}), workflowId: 'wf-1', attempt: 0,
    userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } as never,
    ...over,
  }
}
const storeWith = (invResolved: unknown) => ({
  approvedOracleForStory: vi.fn().mockResolvedValue(null),
  approvedGoldensForStory: vi.fn().mockResolvedValue(null),
  approvedInvariantsForStory: vi.fn().mockResolvedValue(invResolved),
})

describe('verifyWp property/invariants (conformance lens)', () => {
  test('propertyEnabled off → 미동작(invariant 미조회)', async () => {
    const store = storeWith(invariants)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, propertyEnabled: false, handlers: { build_project: okBuilder, run_tests: okTester } }))
    expect(v.ok).toBe(true)
    expect(store.approvedInvariantsForStory).not.toHaveBeenCalled()
  })

  test('승인 invariant 없음 → skip(ok)', async () => {
    const store = storeWith(null)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, propertyEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester } }))
    expect(v.ok).toBe(true)
    expect(store.approvedInvariantsForStory).toHaveBeenCalled()
  })

  test('property 충족(author 테스트 통과) → ok', async () => {
    const store = storeWith(invariants)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, propertyEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, develop_code: author } }))
    expect(v.ok).toBe(true)
  })

  test('property 위반(테스트 실패) → fail(blocking)', async () => {
    const store = storeWith(invariants)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, propertyEnabled: true, handlers: { build_project: okBuilder, run_tests: failTester, develop_code: author } }))
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toContain('run_tests')
  })

  test('author 미작성(테스트 파일 0) → fail-closed(PROPERTY_DIR)', async () => {
    const store = storeWith(invariants)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, propertyEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, develop_code: emptyAuthor } }))
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toContain(PROPERTY_DIR)
  })
})
