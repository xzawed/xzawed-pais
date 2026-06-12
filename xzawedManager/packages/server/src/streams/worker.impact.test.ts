import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { handleWpDispatchSignal, type WorkerDeps } from './worker.js'
import type { WpDispatchSignalMessage } from './dispatch-signal.js'
import { IMPACT_DIR } from './conformance.js'

const wp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'] } as unknown as WorkPackage
const msg = { envelope: { workflowId: 'wf-1' }, payload: { wpId: 'wp-1', attempt: 0 } } as unknown as WpDispatchSignalMessage
const golden = [{ id: 'g1', inputFixture: 'IN', normalizedOutput: 'OUT', normalizers: [], frozenAt: '', frozenBy: 'po', fromDecision: null, version: 1 }]
const okTester = { execute: vi.fn().mockResolvedValue({ success: true, passed: 1, failed: 0 }) }
const okBuilder = { execute: vi.fn().mockResolvedValue({ success: true }) }
const author = { execute: vi.fn().mockResolvedValue({ artifacts: [`${IMPACT_DIR}/wp-1.test.ts`] }) }

describe('worker impact 통합 (threading)', () => {
  test('verifyEnabled+impactEnabled+oracleStore면 verifyWp→runImpactCheck가 approvedGoldensForStory를 호출', async () => {
    const approvedGoldensForStory = vi.fn().mockResolvedValue(golden)
    const oracleStore = { approvedOracleForStory: vi.fn().mockResolvedValue(null), approvedGoldensForStory }
    const deps: WorkerDeps = {
      repo: {
        getGraph: vi.fn().mockResolvedValue({ workPackages: [wp], userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } }),
        latestStates: vi.fn().mockResolvedValue(new Map()),
      } as unknown as WorkerDeps['repo'],
      handlers: { develop_code: author, build_project: okBuilder, run_tests: okTester },
      publish: vi.fn().mockResolvedValue(undefined),
      verifyEnabled: true,
      impactEnabled: true,
      oracleStore: oracleStore as never,
    }
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
    expect(approvedGoldensForStory).toHaveBeenCalledWith('wf-1', 's1')
  })

  test('impactEnabled off면 approvedGoldensForStory 미호출(회귀 0)', async () => {
    const approvedGoldensForStory = vi.fn().mockResolvedValue(golden)
    const oracleStore = { approvedOracleForStory: vi.fn().mockResolvedValue(null), approvedGoldensForStory }
    const deps: WorkerDeps = {
      repo: {
        getGraph: vi.fn().mockResolvedValue({ workPackages: [wp], userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } }),
        latestStates: vi.fn().mockResolvedValue(new Map()),
      } as unknown as WorkerDeps['repo'],
      handlers: { develop_code: author, build_project: okBuilder, run_tests: okTester },
      publish: vi.fn().mockResolvedValue(undefined),
      verifyEnabled: true,
      impactEnabled: false,
      oracleStore: oracleStore as never,
    }
    await handleWpDispatchSignal(msg, deps)
    expect(approvedGoldensForStory).not.toHaveBeenCalled()
  })
})
