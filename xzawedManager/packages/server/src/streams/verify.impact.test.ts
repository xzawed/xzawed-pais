import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { verifyWp, type VerifyDeps } from './verify.js'
import { IMPACT_DIR } from './conformance.js'

const devWp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'] } as unknown as WorkPackage
const golden = [{ id: 'g1', inputFixture: 'IN', normalizedOutput: 'OUT', normalizers: [], frozenAt: '', frozenBy: 'po', fromDecision: null, version: 1 }]
const okResult = { success: true, passed: 1, failed: 0 }
const okBuilder = { execute: vi.fn().mockResolvedValue({ success: true }) }
const okTester = { execute: vi.fn().mockResolvedValue({ success: true, passed: 1, failed: 0 }) }
const failTester = { execute: vi.fn().mockResolvedValue({ success: false, passed: 0, failed: 1 }) }
const author = { execute: vi.fn().mockResolvedValue({ artifacts: [`${IMPACT_DIR}/wp-1.test.ts`] }) }
const emptyAuthor = { execute: vi.fn().mockResolvedValue({ artifacts: [] }) }

function baseDeps(over: Partial<VerifyDeps>): VerifyDeps {
  return {
    handlers: {}, buildInput: () => ({}), workflowId: 'wf-1', attempt: 0,
    userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } as never,
    ...over,
  }
}
const storeWith = (goldensResolved: unknown) => ({
  approvedOracleForStory: vi.fn().mockResolvedValue(null),
  approvedGoldensForStory: vi.fn().mockResolvedValue(goldensResolved),
})

describe('verifyWp golden-differential (impact)', () => {
  test('impactEnabled off → impact 미동작(golden 미조회)', async () => {
    const store = storeWith(golden)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, impactEnabled: false, handlers: { build_project: okBuilder, run_tests: okTester } }))
    expect(v.ok).toBe(true)
    expect(store.approvedGoldensForStory).not.toHaveBeenCalled()
  })

  test('승인 golden 없음 → skip(ok)', async () => {
    const store = storeWith(null)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, impactEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester } }))
    expect(v.ok).toBe(true)
    expect(store.approvedGoldensForStory).toHaveBeenCalled()
  })

  test('golden 일치(author 테스트 통과) → ok', async () => {
    const store = storeWith(golden)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, impactEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, develop_code: author } }))
    expect(v.ok).toBe(true)
  })

  test('golden drift(테스트 실패) → fail(blocking)', async () => {
    const store = storeWith(golden)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, impactEnabled: true, handlers: { build_project: okBuilder, run_tests: failTester, develop_code: author } }))
    expect(v.ok).toBe(false)
  })

  test('author 미작성(테스트 파일 0) → fail-closed', async () => {
    const store = storeWith(golden)
    const v = await verifyWp('develop_code', devWp, okResult,
      baseDeps({ oracleStore: store as never, impactEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, develop_code: emptyAuthor } }))
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toContain(IMPACT_DIR)
  })
})
