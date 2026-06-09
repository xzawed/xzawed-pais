import { describe, it, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import { handleWpDispatchSignal, buildWorkerInput, shouldWireWorker, type WorkerDeps } from './worker.js'
import { WP_DISPATCH_SIGNAL } from './dispatch-signal.js'

const wp = (over: Partial<WorkPackage> = {}): WorkPackage => ({
  id: over.id ?? 'a', storyId: 's1', owningRole: over.owningRole ?? 'developer', oracleRef: null,
  acceptanceCriteria: over.acceptanceCriteria ?? ['ac1'], dependencies: [], attributionCounters: {}, status: 'draft',
})
const sig = (wpId = 'a', attempt = 0) => ({
  envelope: { eventId: '11111111-1111-1111-1111-111111111111', correlationId: 'wf1', causationId: null, workflowId: 'wf1', stepId: `wp.dispatch_signal:${wpId}`, attemptId: attempt, idempotencyKey: `wf1:wp.dispatch_signal:${wpId}:${attempt}`, occurredAt: 1 },
  type: WP_DISPATCH_SIGNAL as const, payload: { wpId, attempt },
})
const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  repo: { getGraph: vi.fn().mockResolvedValue({ workPackages: [wp()], eventId: 'e1', version: 1 }) } as never,
  handlers: { develop_code: { execute: vi.fn().mockResolvedValue({}) } },
  publish: vi.fn().mockResolvedValue('1-0'),
  ...over,
})

describe('handleWpDispatchSignal', () => {
  it('정상: owningRole 핸들러 호출 + wp.completion 발행 → completed', async () => {
    const d = deps()
    const out = await handleWpDispatchSignal(sig(), d)
    expect(out).toEqual({ status: 'completed', wpId: 'a' })
    expect((d.handlers.develop_code.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.any(Object), 'wf1')
    const [stream, msg] = (d.publish as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(stream).toBe('manager:completions:main')
    expect(msg).toMatchObject({ type: 'wp.completion', payload: { wpId: 'a' } })
  })
  it('완료 신호 멱등키는 신호 attempt를 반영(reclaim 재완료 dedup 회피)', async () => {
    const d = deps()
    await handleWpDispatchSignal(sig('a', 2), d)
    const [, msg] = (d.publish as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(msg.envelope.attemptId).toBe(2)
    expect(msg.envelope.idempotencyKey).toBe('wf1:wp.completion:a:2')
  })
  it('WP 미발견 → skipped:wp_not_found·무발행', async () => {
    const d = deps({ repo: { getGraph: vi.fn().mockResolvedValue({ workPackages: [], eventId: null, version: 1 }) } as never })
    expect(await handleWpDispatchSignal(sig(), d)).toEqual({ status: 'skipped', reason: 'wp_not_found' })
    expect((d.publish as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
  it('미지 owningRole(watcher) → skipped:unknown_role·무발행', async () => {
    const d = deps({ repo: { getGraph: vi.fn().mockResolvedValue({ workPackages: [wp({ owningRole: 'watcher' })], eventId: null, version: 1 }) } as never })
    expect(await handleWpDispatchSignal(sig(), d)).toEqual({ status: 'skipped', reason: 'unknown_role' })
    expect((d.publish as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
  it('핸들러 미주입 → skipped:no_handler', async () => {
    const d = deps({ handlers: {} })
    expect(await handleWpDispatchSignal(sig(), d)).toEqual({ status: 'skipped', reason: 'no_handler' })
  })
  it('핸들러 throw → failed:agent_error·무발행(lease 백스톱)', async () => {
    const d = deps({ handlers: { develop_code: { execute: vi.fn().mockRejectedValue(new Error('x')) } } })
    expect(await handleWpDispatchSignal(sig(), d)).toEqual({ status: 'failed', reason: 'agent_error' })
    expect((d.publish as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
  it('owningRole 라우팅: tester → run_tests 핸들러', async () => {
    const run = vi.fn().mockResolvedValue({})
    const d = deps({
      repo: { getGraph: vi.fn().mockResolvedValue({ workPackages: [wp({ owningRole: 'tester' })], eventId: null, version: 1 }) } as never,
      handlers: { run_tests: { execute: run } },
    })
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
    expect(run).toHaveBeenCalled()
  })
})

describe('buildWorkerInput / shouldWireWorker', () => {
  it('buildWorkerInput은 AC를 intent에 담고 검증된 union 값을 채움(context=record·target=development·severity=low)', () => {
    const i = buildWorkerInput(wp({ acceptanceCriteria: ['ac1', 'ac2'] })) as Record<string, unknown>
    expect(String(i.intent)).toContain('ac1')
    // buildAgentQueryPayload(검증된 union)과 동일 — context는 객체(z.record), target/severity는 placeholder enum.
    expect(i).toMatchObject({ context: {}, priority: 'normal', projectPath: '', target: 'development', severity: 'low', artifacts: [] })
    expect(typeof i.context).toBe('object')
  })
  it('shouldWireWorker 진리표', () => {
    expect(shouldWireWorker(false, true)).toBe(false)
    expect(shouldWireWorker(true, false)).toBe(false)
    expect(shouldWireWorker(false, false)).toBe(false)
    expect(shouldWireWorker(true, true)).toBe(true)
  })
})
