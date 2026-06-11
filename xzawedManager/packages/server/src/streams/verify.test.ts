import { describe, it, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { UserContext } from '../types/user-context.js'
import {
  judgePrimaryResult, planVerificationChecks, verifyWp, publishVerificationFailed, verifySessionId,
  WP_VERIFICATION_FAILED, type VerifyDeps,
} from './verify.js'

describe('judgePrimaryResult — 결과-근거 판정(fail-closed)', () => {
  it('run_tests: success=true·failed=0 → ok', () => {
    expect(judgePrimaryResult('run_tests', { success: true, failed: 0, passed: 3 })).toEqual({ ok: true })
  })
  it('run_tests: success=false → fail(사유 포함)', () => {
    const v = judgePrimaryResult('run_tests', { success: false, failed: 2, passed: 1 })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('run_tests')
  })
  it('run_tests: success=true라도 failed>0 → fail', () => {
    expect(judgePrimaryResult('run_tests', { success: true, failed: 1, passed: 3 }).ok).toBe(false)
  })
  it('run_tests: 필드 부재(파싱 실패) → fail — 기본값에 기대지 않는 fail-closed', () => {
    expect(judgePrimaryResult('run_tests', { passed: 3 }).ok).toBe(false)
    expect(judgePrimaryResult('run_tests', null).ok).toBe(false)
    expect(judgePrimaryResult('run_tests', 'ok').ok).toBe(false)
  })
  it('run_tests: success=true·failed=0이라도 passed=0 → fail (빈 스위트 vacuous-pass 봉합·N8)', () => {
    const v = judgePrimaryResult('run_tests', { success: true, failed: 0, passed: 0 })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('vacuous')
  })
  it('run_tests: passed 필드 부재 → fail (실행 통과 미확인=실패·기본값 비의존)', () => {
    expect(judgePrimaryResult('run_tests', { success: true, failed: 0 }).ok).toBe(false)
  })
  it('build_project: success=true → ok / false·부재 → fail', () => {
    expect(judgePrimaryResult('build_project', { success: true })).toEqual({ ok: true })
    expect(judgePrimaryResult('build_project', { success: false }).ok).toBe(false)
    expect(judgePrimaryResult('build_project', {}).ok).toBe(false)
  })
  it('결과-근거 채널 비적용 도구(develop_code·design_ui·security_audit) → ok(pass-through)', () => {
    expect(judgePrimaryResult('develop_code', { artifacts: [] })).toEqual({ ok: true })
    expect(judgePrimaryResult('design_ui', null)).toEqual({ ok: true })
    expect(judgePrimaryResult('security_audit', undefined)).toEqual({ ok: true })
  })
})

describe('planVerificationChecks — 파생 체크 플랜', () => {
  it('develop_code → 빌드 먼저, 테스트 다음(fail-fast 순서)', () => {
    expect(planVerificationChecks('develop_code')).toEqual(['build_project', 'run_tests'])
  })
  it('그 외 도구(자기결과가 ground truth거나 채널 부재) → 빈 플랜', () => {
    expect(planVerificationChecks('run_tests')).toEqual([])
    expect(planVerificationChecks('build_project')).toEqual([])
    expect(planVerificationChecks('design_ui')).toEqual([])
    expect(planVerificationChecks('security_audit')).toEqual([])
  })
})

const wpFix = (over: Partial<WorkPackage> = {}): WorkPackage => ({
  id: 'a', storyId: 's1', owningRole: 'developer', oracleRef: null,
  acceptanceCriteria: ['ac1'], dependencies: [], attributionCounters: {}, status: 'draft', ...over,
})
const buildInput = (wp: WorkPackage) => ({ projectPath: '/ws', wp: wp.id })

describe('verifyWp — 검증 오케스트레이션(fail-closed·never-throw)', () => {
  const uc = { userId: 'u1', projectId: 'p1', workspaceRoot: '/ws' }
  const okExec = () => ({ execute: vi.fn().mockResolvedValue({ success: true, failed: 0, passed: 1 }) })

  it('결과-근거 판정 실패(run_tests WP가 success=false) → 파생 체크 없이 즉시 fail', async () => {
    const deps: VerifyDeps = { handlers: {}, buildInput, workflowId: 'wf1', attempt: 0 }
    const v = await verifyWp('run_tests', wpFix(), { success: false, failed: 3 }, deps)
    expect(v.ok).toBe(false)
  })
  it('develop_code: 빌드·테스트 둘 다 통과 → ok (호출 순서: build → test)', async () => {
    const calls: string[] = []
    const mk = (name: string) => ({
      execute: vi.fn().mockImplementation(() => { calls.push(name); return Promise.resolve({ success: true, failed: 0, passed: 1 }) }),
    })
    const deps: VerifyDeps = {
      handlers: { build_project: mk('build'), run_tests: mk('test') },
      buildInput, userContext: uc, workflowId: 'wf1', attempt: 0,
    }
    expect(await verifyWp('develop_code', wpFix(), { artifacts: [] }, deps)).toEqual({ ok: true })
    expect(calls).toEqual(['build', 'test'])
  })
  it('develop_code: 빌드 실패 → fail-fast(run_tests 미호출)', async () => {
    const test = okExec()
    const deps: VerifyDeps = {
      handlers: { build_project: { execute: vi.fn().mockResolvedValue({ success: false }) }, run_tests: test },
      buildInput, userContext: uc, workflowId: 'wf1', attempt: 0,
    }
    const v = await verifyWp('develop_code', wpFix(), {}, deps)
    expect(v.ok).toBe(false)
    expect(test.execute).not.toHaveBeenCalled()
  })
  it('체크 핸들러 execute throw → fail(불확실=실패·never-throw)', async () => {
    const deps: VerifyDeps = {
      handlers: { build_project: { execute: vi.fn().mockRejectedValue(new Error('boom')) }, run_tests: okExec() },
      buildInput, userContext: uc, workflowId: 'wf1', attempt: 0,
    }
    const v = await verifyWp('develop_code', wpFix(), {}, deps)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('build_project')
  })
  it('체크 핸들러 미주입 → fail(fail-closed)', async () => {
    const deps: VerifyDeps = { handlers: {}, buildInput, userContext: uc, workflowId: 'wf1', attempt: 0 }
    expect((await verifyWp('develop_code', wpFix(), {}, deps)).ok).toBe(false)
  })
  it('workspaceRoot 미영속이면 파생 체크를 돌리지 않고 즉시 fail — 에이전트 cwd 기준 \'.\' 검증의 false PASS 차단', async () => {
    const build = okExec()
    const deps: VerifyDeps = { handlers: { build_project: build, run_tests: okExec() }, buildInput, workflowId: 'wf1', attempt: 0 }
    const v = await verifyWp('develop_code', wpFix(), {}, deps)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('workspaceRoot')
    expect(build.execute).not.toHaveBeenCalled()
  })
  it('체크 execute에 buildInput(wp, uc) 결과·격리 세션 키·userContext가 전달된다', async () => {
    const build = okExec()
    const deps: VerifyDeps = {
      handlers: { build_project: build, run_tests: okExec() },
      buildInput: (wp, u) => ({ projectPath: u?.workspaceRoot, id: wp.id }),
      userContext: uc, workflowId: 'wf1', attempt: 2,
    }
    await verifyWp('develop_code', wpFix(), {}, deps)
    // 워크플로 공유 세션이 아니라 (wpId, attempt) 격리 세션 — 좀비 응답 교차 귀속 차단
    expect(build.execute).toHaveBeenCalledWith({ projectPath: '/ws', id: 'a' }, 'wf1-verify-a-2', uc)
  })
  it('verifySessionId는 (wf, wpId, attempt) 결정론 키', () => {
    expect(verifySessionId('wf1', 'a', 0)).toBe('wf1-verify-a-0')
    expect(verifySessionId('wf1', 'a', 1)).not.toBe(verifySessionId('wf1', 'a', 0))
    expect(verifySessionId('wf1', 'b', 0)).not.toBe(verifySessionId('wf1', 'a', 0))
  })
  it('파생 체크 비대상 도구(design_ui) → 즉시 ok', async () => {
    const deps: VerifyDeps = { handlers: {}, buildInput, workflowId: 'wf1', attempt: 0 }
    expect(await verifyWp('design_ui', wpFix({ owningRole: 'designer' }), null, deps)).toEqual({ ok: true })
  })
})

describe('verifySessionId suffix', () => {
  it('appends suffix when provided, omits otherwise (P4b-1 unchanged)', () => {
    expect(verifySessionId('wf', 'wp', 0)).toBe('wf-verify-wp-0')
    expect(verifySessionId('wf', 'wp', 0, 'conf-author')).toBe('wf-verify-wp-0-conf-author')
  })
})

describe('verifyWp conformance (develop_code)', () => {
  const devWp = { id: 'wp-1', storyId: 'story-1', owningRole: 'developer', acceptanceCriteria: ['AC-1'], oracleRef: null, dependsOn: [] } as unknown as WorkPackage
  const uc: UserContext = { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' }
  const okTester = { execute: vi.fn().mockResolvedValue({ success: true, failed: 0, passed: 1 }) }
  const okBuilder = { execute: vi.fn().mockResolvedValue({ success: true }) }
  const approvedScenarios = [{ id: 's1', title: 't', given: [], when: 'w', thenSteps: ['ok'], status: 'human_approved' as const }]
  function baseDeps(over: Record<string, unknown> = {}) {
    return {
      handlers: { build_project: okBuilder, run_tests: okTester },
      buildInput: () => ({ projectPath: '/abs/ws', context: {} }),
      userContext: uc, workflowId: 'wf-1', attempt: 0,
      ...over,
    }
  }

  it('skips conformance when conformanceEnabled is false → ok via P4b-1 path', async () => {
    const store = { approvedOracleForStory: vi.fn() }
    const v = await verifyWp('develop_code', devWp, {}, baseDeps({ oracleStore: store, conformanceEnabled: false }) as never)
    expect(v.ok).toBe(true)
    expect(store.approvedOracleForStory).not.toHaveBeenCalled()
  })

  it('skips conformance when no approved oracle → ok', async () => {
    const store = { approvedOracleForStory: vi.fn().mockResolvedValue(null) }
    const v = await verifyWp('develop_code', devWp, {}, baseDeps({ oracleStore: store, conformanceEnabled: true }) as never)
    expect(v.ok).toBe(true)
  })

  it('fails when author returns no conformance test file', async () => {
    const store = { approvedOracleForStory: vi.fn().mockResolvedValue({ scenarios: approvedScenarios, coverage: {} }) }
    const author = { execute: vi.fn().mockResolvedValue({ artifacts: ['src/impl.ts'] }) }
    const v = await verifyWp('develop_code', devWp, {},
      baseDeps({ oracleStore: store, conformanceEnabled: true, handlers: { build_project: okBuilder, run_tests: okTester, develop_code: author } }) as never)
    expect(v.ok).toBe(false)
  })

  it('passes when author writes a conformance test and Tester runs it green', async () => {
    const store = { approvedOracleForStory: vi.fn().mockResolvedValue({ scenarios: approvedScenarios, coverage: {} }) }
    const author = { execute: vi.fn().mockResolvedValue({ artifacts: ['.xzawed/conformance/wp-1.test.ts'] }) }
    const runner = { execute: vi.fn().mockResolvedValue({ success: true, failed: 0, passed: 1 }) }
    const v = await verifyWp('develop_code', devWp, {},
      baseDeps({ oracleStore: store, conformanceEnabled: true, handlers: { build_project: okBuilder, run_tests: runner, develop_code: author } }) as never)
    expect(v.ok).toBe(true)
    expect(author.execute.mock.calls[0][1]).toBe('wf-1-verify-wp-1-0-conf-author')
    const runCall = runner.execute.mock.calls.find((c: unknown[]) => (c[1] as string).includes('conf-run'))
    expect(runCall![1]).toBe('wf-1-verify-wp-1-0-conf-run')
    expect((runCall![0] as { testFiles: string[] }).testFiles).toEqual(['.xzawed/conformance/wp-1.test.ts'])
  })

  it('fails when conformance test runs red', async () => {
    const store = { approvedOracleForStory: vi.fn().mockResolvedValue({ scenarios: approvedScenarios, coverage: {} }) }
    const author = { execute: vi.fn().mockResolvedValue({ artifacts: ['.xzawed/conformance/wp-1.test.ts'] }) }
    const runner = { execute: vi.fn()
      .mockResolvedValueOnce({ success: true, failed: 0, passed: 1 })
      .mockResolvedValueOnce({ success: false, failed: 2, passed: 3 }) }
    const v = await verifyWp('develop_code', devWp, {},
      baseDeps({ oracleStore: store, conformanceEnabled: true, handlers: { build_project: okBuilder, run_tests: runner, develop_code: author } }) as never)
    expect(v.ok).toBe(false)
  })

  it('fails when workspaceRoot is missing', async () => {
    const store = { approvedOracleForStory: vi.fn().mockResolvedValue({ scenarios: approvedScenarios, coverage: {} }) }
    const author = { execute: vi.fn() }
    const v = await verifyWp('develop_code', devWp, {},
      baseDeps({ oracleStore: store, conformanceEnabled: true, userContext: undefined, handlers: { build_project: okBuilder, run_tests: okTester, develop_code: author } }) as never)
    expect(v.ok).toBe(false)
    expect(author.execute).not.toHaveBeenCalled()
  })
})

describe('publishVerificationFailed — 관측 이벤트', () => {
  it('manager:events:{wf}에 wp.verification.failed 발행(멱등키=wf:type:wpId:attempt·reason 클램프)', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    await publishVerificationFailed(publish, 'wf1', 'a', 2, 'x'.repeat(900), 1000)
    const [stream, msg] = publish.mock.calls[0]!
    expect(stream).toBe('manager:events:wf1')
    expect(msg.type).toBe(WP_VERIFICATION_FAILED)
    expect(msg.envelope.idempotencyKey).toBe('wf1:wp.verification.failed:a:2')
    expect(msg.envelope.attemptId).toBe(2)
    expect(msg.payload.wpId).toBe('a')
    expect(msg.payload.reason.length).toBeLessThanOrEqual(500)
  })
})
