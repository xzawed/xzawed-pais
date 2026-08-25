import { describe, it, expect, vi, beforeEach } from 'vitest'

const produceDecomposition = vi.fn().mockResolvedValue({ emitted: 1, escalated: false })
vi.mock('../decompose/producer.js', () => ({ produceDecomposition }))

const { buildRedecomposeIntent, makeSpecFixRedecompose, FEEDBACK_MAX } = await import('./spec-fix.js')
const { buildDefectBrief } = await import('./decision-brief.js')
const { buildDecisionRecordedHandler } = await import('./decision-consumer.js')
const { makeRedecompose } = await import('./supervisor.js')

/**
 * **`spec_fix` 가 재분해를 실제로 트리거한다**(S7.2 / 결함 F6).
 *
 * 결정 소비자에는 `fix_reverify`·`accept_known`·`approve` 세 분기뿐이었고 `spec_fix` 는 조용히
 * 빠져나갔다. 그래서 `buildDefectBrief` 가 그 버튼을 **일부러 안 그리고** 있었다(거짓 affordance
 * 제거 — S7.3 의 규칙). 핸들러가 생겨야 버튼도 돌아온다.
 *
 * **재분해에 필요한 재료가 없던 것이 진짜 선행이었다.** `produceDecomposition(intent, …)` 인데
 * intent 는 어디에도 영속되지 않았다 — `graph_dag` 에 `userContext` 와 같은 방식으로 얹어 풀었다
 * (JSONB 라 마이그레이션 0).
 */

beforeEach(() => { produceDecomposition.mockClear() })

describe('buildRedecomposeIntent — 사람 피드백이 새 입력이다', () => {
  it('피드백이 있으면 원 스펙에 덧붙인다', () => {
    const out = buildRedecomposeIntent('로그인 기능', '소셜 로그인은 범위 밖이다')
    expect(out).toContain('로그인 기능')
    expect(out).toContain('소셜 로그인은 범위 밖이다')
    expect(out).toContain('사람 피드백')
  })

  /** 피드백이 없으면 같은 입력으로 같은 분해가 나온다 — 그래도 원 스펙을 손상시키지는 않는다. */
  it('피드백이 없으면 원 스펙 그대로다', () => {
    expect(buildRedecomposeIntent('로그인 기능', null)).toBe('로그인 기능')
    expect(buildRedecomposeIntent('로그인 기능', '   ')).toBe('로그인 기능')
  })

  it('긴 피드백은 잘라 넣는다(분해 프롬프트 잠식 방지)', () => {
    const out = buildRedecomposeIntent('스펙', 'F'.repeat(FEEDBACK_MAX + 500))
    expect(out.length).toBeLessThan('스펙'.length + FEEDBACK_MAX + 100)
  })
})

describe('makeSpecFixRedecompose — 재료가 없으면 돌리지 않는다', () => {
  const uc = { userId: 'u', projectId: 'p', workspaceRoot: '/abs/ws' } as never
  const decompose = {} as never

  it('저장된 intent 로 재분해한다', async () => {
    const store = { getGraph: vi.fn().mockResolvedValue({ intent: '로그인 기능', userContext: uc }) }
    const r = await makeSpecFixRedecompose(store, decompose)('wf1', '소셜은 제외')
    expect(r).toEqual({ status: 'redecomposed' })
    const [intentArg, wfArg, , ucArg] = produceDecomposition.mock.calls[0]!
    expect(intentArg).toContain('로그인 기능')
    expect(intentArg).toContain('소셜은 제외')
    expect(wfArg).toBe('wf1')
    expect(ucArg).toBe(uc)
  })

  /** 레거시 그래프에는 분해 입력이 없다 — 빈 스펙으로 돌리면 WP 를 통째로 갈아엎는다. */
  it('intent 가 저장돼 있지 않으면 재분해하지 않는다(fail-closed)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = { getGraph: vi.fn().mockResolvedValue({ intent: null, userContext: uc }) }
    expect(await makeSpecFixRedecompose(store, decompose)('wf1', 'x')).toEqual({
      status: 'skipped', reason: 'intent_not_stored',
    })
    expect(produceDecomposition).not.toHaveBeenCalled()
  })

  it('그래프가 없으면 재분해하지 않는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = { getGraph: vi.fn().mockResolvedValue(null) }
    expect(await makeSpecFixRedecompose(store, decompose)('wf1', null)).toEqual({
      status: 'skipped', reason: 'graph_not_found',
    })
    expect(produceDecomposition).not.toHaveBeenCalled()
  })
})

describe('makeRedecompose — 접근자를 호출 시점에 평가한다', () => {
  /** `createSupervisor` 시점에 `decompose` 는 아직 없다 — 값으로 잡으면 영원히 undefined 다. */
  it('접근자가 나중에 값을 주면 재분해한다', async () => {
    let late: unknown
    const repo = { getGraph: vi.fn().mockResolvedValue({ intent: '스펙', userContext: null }) } as never
    const fn = makeRedecompose(repo, () => late as never)
    late = {} // createSupervisor 이후에 조립되는 상황
    expect(await fn('wf1', null)).toEqual({ status: 'redecomposed' })
  })

  it('호출 시점에도 없으면 사유를 남기고 생략한다(조용한 no-op 아님)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = { getGraph: vi.fn() } as never
    expect(await makeRedecompose(repo, () => undefined)('wf1', null)).toEqual({
      status: 'skipped', reason: 'decompose_disabled',
    })
    expect(warn).toHaveBeenCalled()
    expect(produceDecomposition).not.toHaveBeenCalled()
  })
})

describe('결정 소비자 배선 — spec_fix 가 재분해로 이어진다', () => {
  const base = {
    decisionStore: { getRequest: vi.fn() },
    leaseStore: { reopenLease: vi.fn() },
    publish: vi.fn(),
    visibilityMs: 1000,
  }
  const msg = (choice: string, justification?: string | null) => ({
    type: 'decision.recorded',
    payload: { requestId: 'r1', choice, decisionId: 'd1', decidedBy: 'u1', ...(justification !== undefined && { justification }) },
  }) as never

  it('spec_fix + defect_brief → redecompose 를 사유와 함께 부른다', async () => {
    const redecompose = vi.fn().mockResolvedValue({ status: 'redecomposed' })
    base.decisionStore.getRequest.mockResolvedValue({ type: 'defect_brief', workflowId: 'wf1', wpId: 'a' })
    await buildDecisionRecordedHandler({ ...base, redecompose } as never)(msg('spec_fix', '스펙이 모호하다'))
    expect(redecompose).toHaveBeenCalledWith('wf1', '스펙이 모호하다')
  })

  it('justification 이 없으면 null 로 넘긴다', async () => {
    const redecompose = vi.fn().mockResolvedValue({ status: 'redecomposed' })
    base.decisionStore.getRequest.mockResolvedValue({ type: 'defect_brief', workflowId: 'wf1' })
    await buildDecisionRecordedHandler({ ...base, redecompose } as never)(msg('spec_fix'))
    expect(redecompose).toHaveBeenCalledWith('wf1', null)
  })

  /** 다른 결정 유형에 붙으면 그 워크플로 분해가 통째로 다시 도는 부작용이 된다. */
  it('defect_brief 가 아니면 재분해하지 않는다(fail-closed)', async () => {
    const redecompose = vi.fn()
    base.decisionStore.getRequest.mockResolvedValue({ type: 'degraded_release', workflowId: 'wf1' })
    await buildDecisionRecordedHandler({ ...base, redecompose } as never)(msg('spec_fix', 'x'))
    expect(redecompose).not.toHaveBeenCalled()
  })

  it('미주입이면 아무 일도 하지 않는다(회귀 0)', async () => {
    base.decisionStore.getRequest.mockClear()
    await buildDecisionRecordedHandler({ ...base } as never)(msg('spec_fix', 'x'))
    expect(base.decisionStore.getRequest).not.toHaveBeenCalled()
  })

  it('fix_reverify 는 재분해로 새지 않는다(기존 분기 보존)', async () => {
    const redecompose = vi.fn()
    base.decisionStore.getRequest.mockResolvedValue({ type: 'defect_brief', workflowId: 'wf1', wpId: 'a' })
    base.leaseStore.reopenLease.mockResolvedValue({ status: 'reopened', attempt: 2 })
    await buildDecisionRecordedHandler({ ...base, redecompose } as never)(msg('fix_reverify'))
    expect(redecompose).not.toHaveBeenCalled()
    expect(base.leaseStore.reopenLease).toHaveBeenCalled()
  })
})

describe('브리프 — 핸들러가 있을 때만 버튼을 그린다', () => {
  const info = { workflowId: 'wf1', wpId: 'a', attempt: 1, stepN: 2 }

  it('배선되면 spec_fix 를 노출한다', () => {
    expect(buildDefectBrief({ ...info, specFixAvailable: true }).context?.options).toEqual(['fix_reverify', 'spec_fix'])
  })

  /** 핸들러 없는 버튼은 눌러도 RESOLVED 만 남기는 거짓 affordance 다(S7.3 이 지운 것). */
  it('미배선이면 노출하지 않는다', () => {
    expect(buildDefectBrief({ ...info, specFixAvailable: false }).context?.options).toEqual(['fix_reverify'])
    expect(buildDefectBrief(info).context?.options).toEqual(['fix_reverify'])
  })

  /** 핸들러가 여전히 없는 choice 는 계속 빠져 있어야 한다. */
  it('accept_known·reject 는 여전히 노출하지 않는다', () => {
    const opts = buildDefectBrief({ ...info, specFixAvailable: true }).context?.options ?? []
    expect(opts).not.toContain('accept_known')
    expect(opts).not.toContain('reject')
  })
})

/**
 * **공백만 있는 스펙은 "있는 것"이 아니다** — Grok 반증이 잡은 자리.
 *
 * 가드가 전부 `.length > 0` 이라 `"   "` 가 통과했고, 트립와이어로 확인해 보니 **실제로
 * 재분해가 돌았다**. 사실상 빈 스펙으로 분해하면 쓰레기 WP 가 나오고 병합으로 그래프가 바뀐다.
 * 저장·읽기·판정 세 경계에서 모두 공백을 걷어낸다.
 */
describe('공백 스펙 — 저장도 재분해도 하지 않는다', () => {
  it.each(['   ', '\t', '\n  \n'])('makeSpecFixRedecompose 는 %j 를 미영속으로 다룬다', async (ws) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = { getGraph: vi.fn().mockResolvedValue({ intent: ws, userContext: null }) }
    expect(await makeSpecFixRedecompose(store, {} as never)('wf1', '피드백')).toEqual({
      status: 'skipped', reason: 'intent_not_stored',
    })
    expect(produceDecomposition).not.toHaveBeenCalled()
  })

  it('앞뒤 공백이 있는 정상 스펙은 다듬어 쓴다(과잉 차단 아님)', async () => {
    const store = { getGraph: vi.fn().mockResolvedValue({ intent: '  로그인 기능  ', userContext: null }) }
    expect(await makeSpecFixRedecompose(store, {} as never)('wf1', null)).toEqual({ status: 'redecomposed' })
    expect(produceDecomposition.mock.calls[0]![0]).toBe('로그인 기능')
  })
})
