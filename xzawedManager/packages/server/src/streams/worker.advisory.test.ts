import { describe, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { handleWpDispatchSignal, type WorkerDeps } from './worker.js'
import type { WpDispatchSignalMessage } from './dispatch-signal.js'

const wp = { id: 'wp-1', storyId: 's1', owningRole: 'developer', acceptanceCriteria: ['AC1'] } as unknown as WorkPackage
const msg = { envelope: { workflowId: 'wf-1' }, payload: { wpId: 'wp-1', attempt: 0 } } as unknown as WpDispatchSignalMessage

function baseDeps(over: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    repo: {
      getGraph: vi.fn().mockResolvedValue({ workPackages: [wp], userContext: undefined }),
      latestStates: vi.fn().mockResolvedValue(new Map()),
    } as unknown as WorkerDeps['repo'],
    handlers: { develop_code: { execute: vi.fn().mockResolvedValue({ artifacts: ['src/x.ts'] }) } },
    publish: vi.fn().mockResolvedValue(undefined),
    verifyEnabled: false,
    ...over,
  }
}
const okClaude = { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ findings: [{ title: 'a', rationale: 'r' }] }) }] }) } }

describe('worker advisory 통합 (N3)', () => {
  test('N3-a: advisory가 findings를 내도 WP는 정상 완료(verdict 경로 불변)', async () => {
    const recordFindings = vi.fn().mockResolvedValue(undefined)
    const deps = baseDeps({
      advisoryEnabled: true, advisoryStore: { recordFindings }, claude: okClaude as never, model: 'm', timeoutMs: 1000,
    })
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
    expect(deps.publish).toHaveBeenCalled() // wp.completion 발행됨
    expect(recordFindings).toHaveBeenCalledTimes(1)
  })

  test('N3-b: advisory 생산자가 throw(LLM 오류)해도 WP는 정상 완료', async () => {
    const recordFindings = vi.fn().mockResolvedValue(undefined)
    const throwClaude = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } }
    const deps = baseDeps({
      advisoryEnabled: true, advisoryStore: { recordFindings }, claude: throwClaude as never, model: 'm', timeoutMs: 1000,
    })
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
    expect(recordFindings).not.toHaveBeenCalled()
  })

  test('N3-c: advisory 비활성(미주입)이면 advisory 미호출·완료 동작 P4b 동일(회귀 0)', async () => {
    const deps = baseDeps() // advisoryEnabled 미주입
    const out = await handleWpDispatchSignal(msg, deps)
    expect(out).toEqual({ status: 'completed', wpId: 'wp-1' })
  })

  test('develop_code가 아닌 WP는 advisory 미호출', async () => {
    const recordFindings = vi.fn().mockResolvedValue(undefined)
    const designWp = { ...wp, owningRole: 'designer' } as WorkPackage
    const deps = baseDeps({
      repo: {
        getGraph: vi.fn().mockResolvedValue({ workPackages: [designWp], userContext: undefined }),
        latestStates: vi.fn().mockResolvedValue(new Map()),
      } as unknown as WorkerDeps['repo'],
      handlers: { design_ui: { execute: vi.fn().mockResolvedValue({ artifacts: [] }) } },
      advisoryEnabled: true, advisoryStore: { recordFindings }, claude: okClaude as never, model: 'm', timeoutMs: 1000,
    })
    await handleWpDispatchSignal(msg, deps)
    expect(recordFindings).not.toHaveBeenCalled()
  })
})
