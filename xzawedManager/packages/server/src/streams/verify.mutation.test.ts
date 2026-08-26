import { describe, test, expect, vi, beforeEach } from 'vitest'
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
  beforeEach(() => { vi.clearAllMocks() })

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

/**
 * **등급별 θ**(S5.4). min-risk 는 **돌릴지**를, θ 는 **얼마나 엄하게**를 정한다 — 두 손잡이가
 * 같은 것을 두 번 말하지 않는다. θ 는 호스트가 아니라 하니스 플랜(프롬프트)에 박히므로,
 * 실제로 등급이 반영됐는지는 develop_code 가 받은 plan 문자열로만 확인할 수 있다.
 */
describe('verifyWp mutation θ — 등급별(S5.4)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const lowWp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'], risk: 'LOW' } as unknown as WorkPackage
  const THETA = { LOW: 0.3, MEDIUM: 0.5, HIGH: 0.9 }

  /** develop_code 가 받은 plan 을 꺼낸다 — θ 가 문자열로 박히는 유일한 지점이다. */
  async function planFor(wp: WorkPackage, minRisk: 'LOW' | 'MEDIUM' | 'HIGH'): Promise<string> {
    const spy = { execute: vi.fn().mockResolvedValue({ artifacts: [`${MUTATION_DIR}/wp-1.test.ts`] }) }
    await verifyWp('develop_code', wp, okResult, baseDeps({
      mutationEnabled: true, mutationMinRisk: minRisk, mutationThetaByRisk: THETA,
      handlers: { build_project: okBuilder, run_tests: okTester, develop_code: spy },
    }))
    const calls = spy.execute.mock.calls
    return JSON.stringify(calls[calls.length - 1])
  }

  test('HIGH WP 는 HIGH θ 를 받는다', async () => {
    const plan = await planFor(hiWp, 'LOW')
    expect(plan).toContain('0.9')
    expect(plan, '다른 등급의 θ 가 새어 들어왔다').not.toContain('0.3')
  })

  test('MEDIUM WP 는 MEDIUM θ 를 받는다', async () => {
    const plan = await planFor(medWp, 'LOW')
    expect(plan).toContain('0.5')
    expect(plan).not.toContain('0.9')
  })

  test('LOW WP 는 LOW θ 를 받는다', async () => {
    const plan = await planFor(lowWp, 'LOW')
    expect(plan).toContain('0.3')
    expect(plan).not.toContain('0.9')
  })

  /** 맵이 배선에서 빠지면 조용히 이 값으로 돌아간다 — 그 상태를 고정해 둔다. */
  test('맵 미주입이면 기본 θ(0.6)로 돌아간다', async () => {
    const spy = { execute: vi.fn().mockResolvedValue({ artifacts: [`${MUTATION_DIR}/wp-1.test.ts`] }) }
    await verifyWp('develop_code', hiWp, okResult, baseDeps({
      mutationEnabled: true, mutationMinRisk: 'HIGH',
      handlers: { build_project: okBuilder, run_tests: okTester, develop_code: spy },
    }))
    expect(JSON.stringify(spy.execute.mock.calls)).toContain('0.6')
  })

  /** min-risk 가 등급을 거르면 θ 는 애초에 닿지 않는다 — 두 손잡이의 역할 분리. */
  test('min-risk 가 거른 등급은 θ 와 무관하게 안 돈다', async () => {
    const spy = { execute: vi.fn().mockResolvedValue({ artifacts: [] }) }
    const v = await verifyWp('develop_code', lowWp, okResult, baseDeps({
      mutationEnabled: true, mutationMinRisk: 'HIGH', mutationThetaByRisk: THETA,
      handlers: { build_project: okBuilder, run_tests: okTester, develop_code: spy },
    }))
    expect(v.ok).toBe(true)
    expect(spy.execute, 'min-risk 게이트를 지나쳐 하니스를 작성했다').not.toHaveBeenCalled()
  })
})
