import { describe, it, test, expect, vi } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { UserContext } from '../types/user-context.js'
import {
  judgePrimaryResult, planVerificationChecks, verifyWp, publishVerificationFailed, verifySessionId,
  WP_VERIFICATION_FAILED, meetsMinRisk, resolveThetaByRisk, nonMonotonicThetaTiers, type VerifyDeps,
} from './verify.js'
import type { ChannelName, ChannelOutcomeKind } from '../db/release-gate.types.js'

function collectorDeps(base: Partial<VerifyDeps>): { deps: VerifyDeps; outcomes: Array<{ c: ChannelName; o: ChannelOutcomeKind }> } {
  const outcomes: Array<{ c: ChannelName; o: ChannelOutcomeKind }> = []
  const deps = {
    handlers: {}, buildInput: () => ({}), workflowId: 'wf-rg', attempt: 0,
    recordOutcome: (c: ChannelName, o: ChannelOutcomeKind) => outcomes.push({ c, o }),
    ...base,
  } as VerifyDeps
  return { deps, outcomes }
}

describe('verifyWp recordOutcome (P5-1a)', () => {
  it('records tc:passed for a passing run_tests WP', async () => {
    const { deps, outcomes } = collectorDeps({})
    const wp = { id: 'wp-1', storyId: 's1', owningRole: 'tester', acceptanceCriteria: [], risk: 'MEDIUM' } as never
    const verdict = await verifyWp('run_tests', wp, { success: true, passed: 3, failed: 0 }, deps)
    expect(verdict.ok).toBe(true)
    expect(outcomes).toContainEqual({ c: 'tc', o: 'passed' })
  })
  it('does NOT record tc when primary fails (vacuous run_tests)', async () => {
    const { deps, outcomes } = collectorDeps({})
    const wp = { id: 'wp-2', storyId: 's1', owningRole: 'tester', acceptanceCriteria: [], risk: 'MEDIUM' } as never
    const verdict = await verifyWp('run_tests', wp, { success: true, passed: 0, failed: 0 }, deps)
    expect(verdict.ok).toBe(false)
    expect(outcomes).toEqual([])
  })
})

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
  it('결과-근거 채널 비적용 도구(develop_code) → ok(pass-through)', () => {
    // develop_code 는 파생 체크(build→test 실 재실행)가 판정한다.
    expect(judgePrimaryResult('develop_code', { artifacts: [] })).toEqual({ ok: true })
  })

  it('design_ui 는 더 이상 pass-through 가 아니다(S5.2b)', () => {
    // 여기 있던 `design_ui → ok` 도 **결함 F4 를 고정하던 단언**이다 — security_audit 과 같은 자리다.
    // 상세 판정은 design-wp-selfverify.test.ts 가 갖는다.
    expect(judgePrimaryResult('design_ui', null).ok).toBe(false)
  })

  it('security_audit 은 더 이상 pass-through 가 아니다(S5.2a)', () => {
    // 여기 있던 `security_audit → ok` 가 **결함 F4 를 고정하던 단언**이다 —
    // 증거 0회로 통과하던 자리라 릴리스 게이트가 그 WP 를 unverifiable 로 영구 차단했다.
    expect(judgePrimaryResult('security_audit', undefined).ok).toBe(false)
    expect(judgePrimaryResult('security_audit', {
      issues: [], auditable: { static: { requested: 1, scanned: 1 }, deps: { status: 'ok' } },
    })).toEqual({ ok: true })
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
  acceptanceCriteria: ['ac1'], dependencies: [], attributionCounters: {}, status: 'DRAFTED', ...over,
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
  it('파생 체크 비대상 도구(design_ui)라도 자기검증은 통과해야 한다(S5.2b)', async () => {
    const deps: VerifyDeps = { handlers: {}, buildInput, workflowId: 'wf1', attempt: 0 }
    // 파생 플랜은 여전히 비어 있지만(실행 가능 ground truth 부재) 자기검증이 먼저 걸린다.
    expect((await verifyWp('design_ui', wpFix({ owningRole: 'designer' }), null, deps)).ok).toBe(false)
    const designed = { components: [{ name: 'A', description: 'a', props: {} }], designed: { source: 'llm', components: 1 } }
    expect(await verifyWp('design_ui', wpFix({ owningRole: 'designer' }), designed, deps)).toEqual({ ok: true })
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

describe('meetsMinRisk', () => {
  test('rank 비교 진리표', () => {
    expect(meetsMinRisk('HIGH', 'HIGH')).toBe(true)
    expect(meetsMinRisk('MEDIUM', 'HIGH')).toBe(false)
    expect(meetsMinRisk('LOW', 'HIGH')).toBe(false)
    expect(meetsMinRisk('HIGH', 'MEDIUM')).toBe(true)
    expect(meetsMinRisk('MEDIUM', 'MEDIUM')).toBe(true)
    expect(meetsMinRisk('LOW', 'MEDIUM')).toBe(false)
    expect(meetsMinRisk('LOW', 'LOW')).toBe(true)
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

/**
 * **등급별 θ 해석**(S5.4). 미설정 등급은 공통 θ 를 그대로 받는다 — 등급별 기본값을 지어내지
 * 않는 것이 이 함수의 계약이다(설계 문서 D2 가 per-tier 를 "운영 데이터 후"로 미뤘다).
 */
describe('resolveThetaByRisk', () => {
  it('아무 오버라이드도 없으면 세 등급이 같다(회귀 0)', () => {
    expect(resolveThetaByRisk(0.6)).toEqual({ LOW: 0.6, MEDIUM: 0.6, HIGH: 0.6 })
  })

  it('설정한 등급만 덮는다', () => {
    expect(resolveThetaByRisk(0.6, { HIGH: 0.9 })).toEqual({ LOW: 0.6, MEDIUM: 0.6, HIGH: 0.9 })
  })

  it('undefined 오버라이드는 없는 것과 같다', () => {
    expect(resolveThetaByRisk(0.6, { LOW: undefined, MEDIUM: 0.4, HIGH: undefined }))
      .toEqual({ LOW: 0.6, MEDIUM: 0.4, HIGH: 0.6 })
  })

  /** 0 은 유효한 바닥이다(사실상 무조건 통과) — falsy 라고 기본값으로 덮으면 안 된다. */
  it('0 을 기본값으로 덮지 않는다', () => {
    expect(resolveThetaByRisk(0.6, { LOW: 0 }).LOW).toBe(0)
  })
})

describe('nonMonotonicThetaTiers', () => {
  it('오름차순이면 거짓', () => {
    expect(nonMonotonicThetaTiers({ LOW: 0.3, MEDIUM: 0.5, HIGH: 0.9 })).toBe(false)
  })

  it('전부 같아도 거짓(기본 상태를 경고하지 않는다)', () => {
    expect(nonMonotonicThetaTiers({ LOW: 0.6, MEDIUM: 0.6, HIGH: 0.6 })).toBe(false)
  })

  it('저위험이 더 엄하면 참', () => {
    expect(nonMonotonicThetaTiers({ LOW: 0.9, MEDIUM: 0.5, HIGH: 0.6 })).toBe(true)
  })

  it('중간만 튀어도 참', () => {
    expect(nonMonotonicThetaTiers({ LOW: 0.3, MEDIUM: 0.9, HIGH: 0.5 })).toBe(true)
  })
})
