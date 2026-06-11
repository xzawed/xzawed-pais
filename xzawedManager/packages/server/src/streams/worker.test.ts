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
const repoMock = (graph: Record<string, unknown>, states = new Map()): WorkerDeps['repo'] =>
  ({ getGraph: vi.fn().mockResolvedValue(graph), latestStates: vi.fn().mockResolvedValue(states) }) as never
const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  repo: repoMock({ workPackages: [wp()], eventId: 'e1', version: 1 }),
  handlers: { develop_code: { execute: vi.fn().mockResolvedValue({}) } },
  publish: vi.fn().mockResolvedValue('1-0'),
  ...over,
})

describe('handleWpDispatchSignal', () => {
  it('정상: owningRole 핸들러 호출 + wp.completion 발행 → completed', async () => {
    const d = deps()
    const out = await handleWpDispatchSignal(sig(), d)
    expect(out).toEqual({ status: 'completed', wpId: 'a' })
    // userContext 미영속 그래프 → 3번째 인자 undefined(P4-1 동작 보존)
    expect((d.handlers.develop_code.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.any(Object), 'wf1', undefined)
    const [stream, msg] = (d.publish as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(stream).toBe('manager:completions:main')
    expect(msg).toMatchObject({ type: 'wp.completion', payload: { wpId: 'a' } })
  })
  it('그래프에 userContext가 영속돼 있으면 execute 3번째 인자 + 입력 projectPath로 주입(P4a-2)', async () => {
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1' }
    const exec = vi.fn().mockResolvedValue({})
    const d = deps({
      repo: { getGraph: vi.fn().mockResolvedValue({ workPackages: [wp()], eventId: 'e1', version: 1, userContext: uc }) } as never,
      handlers: { develop_code: { execute: exec } },
    })
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/workspace/p1' }), 'wf1', uc)
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

describe('검증 게이트(P4b-1·verifyEnabled)', () => {
  it('verifyEnabled 미지정(기본) → 검증 미수행·기존 동작 보존(success=false 결과도 completed)', async () => {
    const d = deps({
      repo: { getGraph: vi.fn().mockResolvedValue({ workPackages: [wp({ owningRole: 'tester' })], eventId: null, version: 1 }) } as never,
      handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: false, failed: 3 }) } },
    })
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
  })
  it('on + 결과-근거 판정 실패(tester success=false) → 완료 미발행 + wp.verification.failed 발행 + outcome', async () => {
    const d = deps({
      verifyEnabled: true,
      repo: repoMock({ workPackages: [wp({ owningRole: 'tester' })], eventId: null, version: 1 }),
      handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: false, failed: 3 }) } },
    })
    const out = await handleWpDispatchSignal(sig('a', 1), d)
    expect(out.status).toBe('verification_failed')
    const calls = (d.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1) // completion 미발행, verification.failed만
    const [stream, msg] = calls[0]!
    expect(stream).toBe('manager:events:wf1')
    expect(msg).toMatchObject({ type: 'wp.verification.failed', payload: { wpId: 'a', attempt: 1 } })
  })
  it('on + 통과(tester success·failed=0) → 기존대로 wp.completion 발행', async () => {
    const d = deps({
      verifyEnabled: true,
      repo: repoMock({ workPackages: [wp({ owningRole: 'tester' })], eventId: null, version: 1 }),
      handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: true, failed: 0 }) } },
    })
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
    const [stream] = (d.publish as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(stream).toBe('manager:completions:main')
  })
  it('on + developer WP: 파생 체크(build→test) 실 호출 — 통과 시 completed', async () => {
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/ws' }
    const build = vi.fn().mockResolvedValue({ success: true })
    const test = vi.fn().mockResolvedValue({ success: true, failed: 0 })
    const d = deps({
      verifyEnabled: true,
      repo: repoMock({ workPackages: [wp()], eventId: null, version: 1, userContext: uc }),
      handlers: {
        develop_code: { execute: vi.fn().mockResolvedValue({ artifacts: ['f.ts'] }) },
        build_project: { execute: build }, run_tests: { execute: test },
      },
    })
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('completed')
    // 체크 입력은 buildWorkerInput(wp, uc) — 세션은 (wpId, attempt) 격리 키·userContext 3번째 인자
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/ws' }), 'wf1-verify-a-0', uc)
    expect(test).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/ws' }), 'wf1-verify-a-0', uc)
  })
  it('on + developer WP: 파생 테스트 실패 → verification_failed·완료 미발행', async () => {
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/ws' }
    const d = deps({
      verifyEnabled: true,
      repo: repoMock({ workPackages: [wp()], eventId: null, version: 1, userContext: uc }),
      handlers: {
        develop_code: { execute: vi.fn().mockResolvedValue({}) },
        build_project: { execute: vi.fn().mockResolvedValue({ success: true }) },
        run_tests: { execute: vi.fn().mockResolvedValue({ success: true, failed: 2 }) },
      },
    })
    const out = await handleWpDispatchSignal(sig(), d)
    expect(out.status).toBe('verification_failed')
    const streams = (d.publish as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(streams).not.toContain('manager:completions:main')
  })
  it('on + developer WP인데 userContext 미영속 → 파생 체크 미실행·verification_failed(fail-closed)', async () => {
    const build = vi.fn().mockResolvedValue({ success: true })
    const d = deps({
      verifyEnabled: true,
      handlers: {
        develop_code: { execute: vi.fn().mockResolvedValue({}) },
        build_project: { execute: build },
        run_tests: { execute: vi.fn().mockResolvedValue({ success: true, failed: 0 }) },
      },
    })
    const out = await handleWpDispatchSignal(sig(), d)
    expect(out.status).toBe('verification_failed')
    expect(build).not.toHaveBeenCalled() // '.' 폴백으로 엉뚱한 프로젝트를 검증하지 않음
  })
  it('on + 최신 상태 DONE이면 에이전트 미실행·stale_signal skip(중복 재실행 차단)', async () => {
    const exec = vi.fn().mockResolvedValue({})
    const d = deps({
      verifyEnabled: true,
      repo: repoMock(
        { workPackages: [wp()], eventId: null, version: 1 },
        new Map([['a', { toState: 'DONE' }]]),
      ),
      handlers: { develop_code: { execute: exec } },
    })
    expect(await handleWpDispatchSignal(sig('a', 1), d)).toEqual({ status: 'skipped', reason: 'stale_signal' })
    expect(exec).not.toHaveBeenCalled()
    expect((d.publish as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
  it('관측 이벤트 발행 throw → outcome 유지(best-effort·never-throw)', async () => {
    const d = deps({
      verifyEnabled: true,
      repo: repoMock({ workPackages: [wp({ owningRole: 'tester' })], eventId: null, version: 1 }),
      handlers: { run_tests: { execute: vi.fn().mockResolvedValue({ success: false, failed: 1 }) } },
      publish: vi.fn().mockRejectedValue(new Error('redis down')),
    })
    expect((await handleWpDispatchSignal(sig(), d)).status).toBe('verification_failed')
  })
})

describe('handleWpDispatchSignal conformance threading (P4b-2)', () => {
  it('threads oracleStore + conformanceEnabled into verifyWp → conformance fail blocks completion', async () => {
    const wp = { id: 'wp-1', storyId: 'story-1', owningRole: 'developer', acceptanceCriteria: ['AC-1'], oracleRef: null, dependsOn: [] }
    const graph = { workPackages: [wp], userContext: { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } }
    const repo = {
      getGraph: vi.fn().mockResolvedValue(graph),
      latestStates: vi.fn().mockResolvedValue(new Map()),
    }
    const okBuilder = { execute: vi.fn().mockResolvedValue({ success: true }) }
    const developer = { execute: vi.fn().mockResolvedValue({ artifacts: ['.xzawed/conformance/wp-1.test.ts'] }) }
    const tester = { execute: vi.fn()
      .mockResolvedValueOnce({ success: true, failed: 0 })   // derived run_tests (P4b-1)
      .mockResolvedValueOnce({ success: false, failed: 1 }) } // conformance run (red)
    const publish = vi.fn().mockResolvedValue(undefined)
    const store = { approvedOracleForStory: vi.fn().mockResolvedValue({ scenarios: [{ id: 's1', title: 't', given: [], when: 'w', thenSteps: ['x'], status: 'human_approved' }], coverage: {} }) }
    const deps = {
      repo, publish,
      handlers: { develop_code: developer, build_project: okBuilder, run_tests: tester },
      verifyEnabled: true, conformanceEnabled: true, oracleStore: store,
      now: () => 1,
    }
    const msg = { envelope: { workflowId: 'wf-1' }, type: 'wp.dispatch_signal', payload: { wpId: 'wp-1', attempt: 0 } } as never
    const outcome = await handleWpDispatchSignal(msg, deps as never)
    expect(outcome.status).toBe('verification_failed')
    const completionPublished = publish.mock.calls.some((c: unknown[]) => (c[1] as { type: string }).type === 'wp.completion')
    expect(completionPublished).toBe(false)
    const failedPublished = publish.mock.calls.some((c: unknown[]) => (c[1] as { type: string }).type === 'wp.verification.failed')
    expect(failedPublished).toBe(true)
  })
})

describe('buildWorkerInput / shouldWireWorker', () => {
  it('buildWorkerInput은 AC를 intent에 담고 검증된 union 값을 채움(context=record·target=development·severity=low)', () => {
    const i = buildWorkerInput(wp({ acceptanceCriteria: ['ac1', 'ac2'] })) as Record<string, unknown>
    expect(String(i.intent)).toContain('ac1')
    // 검증된 union 타입 — context는 객체(z.record), target/severity는 placeholder enum, projectPath는 '.'(폴백·P4-1 보존).
    expect(i).toMatchObject({ context: {}, priority: 'normal', projectPath: '.', target: 'development', severity: 'low', artifacts: [] })
    expect(typeof i.context).toBe('object')
    expect(String(i.plan)).toContain('ac1') // developer는 plan을 읽음(빈 plan no-op 방지)
  })
  it('userContext가 있으면 projectPath=workspaceRoot 절대경로(P4a-2 — cwd 무관 realpath 통과)·나머지 형상 보존', () => {
    const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1' }
    const i = buildWorkerInput(wp({ acceptanceCriteria: ['ac1'] }), uc) as Record<string, unknown>
    expect(i).toMatchObject({
      context: {}, priority: 'normal', projectPath: '/workspace/p1',
      target: 'development', severity: 'low', artifacts: [],
    })
    expect(String(i.intent)).toContain('ac1')
    expect(String(i.plan)).toContain('ac1')
  })
  it('intent는 4000자 클램프(planner/designer .max(4000))·plan은 AC 무손실 보존', () => {
    const longAc = 'x'.repeat(3000)
    const i = buildWorkerInput(wp({ acceptanceCriteria: [longAc, longAc] })) as Record<string, unknown>
    expect(String(i.intent).length).toBeLessThanOrEqual(4000)
    expect(String(i.plan)).toContain(longAc) // developer가 읽는 plan은 전체 보존
    expect(String(i.plan).length).toBeGreaterThan(4000)
  })
  it('shouldWireWorker 진리표', () => {
    expect(shouldWireWorker(false, true)).toBe(false)
    expect(shouldWireWorker(true, false)).toBe(false)
    expect(shouldWireWorker(false, false)).toBe(false)
    expect(shouldWireWorker(true, true)).toBe(true)
  })
})
