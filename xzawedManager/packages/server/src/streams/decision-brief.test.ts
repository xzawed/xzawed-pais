import { describe, it, expect, vi } from 'vitest'
import { buildDefectBrief, makeEscalationBrief, localizeFault, expiresAtFrom, type DecisionBriefStore, type EscalationInfo } from './decision-brief.js'

const INFO = { workflowId: 'wf-1', wpId: 'wp_abc', attempt: 2, stepN: 3 }

describe('buildDefectBrief (§15 결함 의사결정 브리프)', () => {
  it('에스컬레이션을 defect_brief DecisionRequest 입력으로 매핑', () => {
    const b = buildDefectBrief(INFO)
    expect(b.type).toBe('defect_brief')
    expect(b.workflowId).toBe('wf-1')
    expect(b.correlationId).toBe('wf-1')
    expect(b.wpId).toBe('wp_abc')
    expect(b.severity).toBe('blocking')
    expect(b.context?.location).toContain('wp_abc')
    expect(b.context?.options).toEqual(['fix_reverify', 'spec_fix', 'accept_known', 'reject']) // §4 choice
  })

  it('requestId는 (wf,wpId,attempt) 결정론 — 재호출 멱등(createRequest ON CONFLICT)', () => {
    expect(buildDefectBrief(INFO).requestId).toBe('wf-1:wp_abc:2')
    expect(buildDefectBrief(INFO).requestId).toBe(buildDefectBrief(INFO).requestId)
  })

  it('expectedVsActual에 시도 횟수(attempt+1) 반영', () => {
    expect(buildDefectBrief(INFO).context?.expectedVsActual).toContain('3') // attempt 2 → 3회 시도
  })
})

describe('localizeFault (§11 결정론 귀속)', () => {
  it('escalate = impl 계층 소진: counters.impl = attempt+1', () => {
    expect(localizeFault({ workflowId: 'wf-1', wpId: 'wp_abc', attempt: 2, stepN: 3 }))
      .toEqual({ faultTier: 'impl_exhausted', counters: { impl: 3, task: 0, plan: 0 } })
  })
  it('attempt 0 → impl 1회', () => {
    expect(localizeFault({ workflowId: 'w', wpId: 'p', attempt: 0, stepN: 0 }).counters.impl).toBe(1)
  })
})

describe('buildDefectBrief §11 귀속 강화', () => {
  it('context.attribution = impl_exhausted 라벨', () => {
    const b = buildDefectBrief({ workflowId: 'wf-1', wpId: 'wp_abc', attempt: 2, stepN: 3 })
    expect(b.context?.attribution).toEqual({ faultTier: 'impl_exhausted', counters: { impl: 3, task: 0, plan: 0 } })
  })
  it('expectedVsActual에 계약사슬 귀속 문구(Task/plan 검토)', () => {
    const b = buildDefectBrief({ workflowId: 'wf-1', wpId: 'wp_abc', attempt: 2, stepN: 3 })
    expect(b.context?.expectedVsActual).toContain('구현')
    expect(b.context?.expectedVsActual).toMatch(/Task|plan/)
  })
  it('impact·evidenceRefs를 채운다(빈 배열 아님)', () => {
    const b = buildDefectBrief({ workflowId: 'wf-1', wpId: 'wp_abc', attempt: 2, stepN: 3 })
    expect(b.context?.impact?.length).toBeGreaterThan(0)
    expect(b.context?.evidenceRefs?.length).toBeGreaterThan(0)
  })
})

describe('makeEscalationBrief (onEscalated 핸들러)', () => {
  it('createRequest를 buildDefectBrief 입력으로 호출', async () => {
    const createRequest = vi.fn().mockResolvedValue({ eventId: 'e1' })
    const store: DecisionBriefStore = { createRequest }
    await makeEscalationBrief(store)(INFO)
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      type: 'defect_brief', requestId: 'wf-1:wp_abc:2', wpId: 'wp_abc',
    }))
  })
})

describe('buildDefectBrief projectId 스레딩 (C0/C1)', () => {
  it('projectId를 DecisionRequestInput에 전파', () => {
    expect(buildDefectBrief({ ...INFO, projectId: 'proj-1' }).projectId).toBe('proj-1')
  })
  it('projectId 미지정 시 null', () => {
    expect(buildDefectBrief(INFO).projectId).toBeNull()
  })
})

describe('expiresAtFrom', () => {
  it('ttlMs 양수 → now+ttl ISO', () => {
    expect(expiresAtFrom(1_000_000, 3_600_000)).toBe(new Date(4_600_000).toISOString())
  })
  it('ttlMs undefined → undefined', () => { expect(expiresAtFrom(1_000_000, undefined)).toBeUndefined() })
  it('ttlMs 0/음수 → undefined', () => {
    expect(expiresAtFrom(1_000_000, 0)).toBeUndefined()
    expect(expiresAtFrom(1_000_000, -5)).toBeUndefined()
  })
})

const INFO2: EscalationInfo = { workflowId: 'wf1', wpId: 'wp1', attempt: 2, stepN: 1 }

describe('makeEscalationBrief expiresAt 주입', () => {
  it('ttlMs 주입 시 createRequest 입력에 expiresAt 존재', async () => {
    let captured: unknown
    const store = { createRequest: async (r: unknown) => { captured = r; return { eventId: 'e' } } }
    await makeEscalationBrief(store, { now: () => 1_000_000, ttlMs: 3_600_000 })(INFO2)
    expect((captured as { expiresAt?: string }).expiresAt).toBe(new Date(4_600_000).toISOString())
  })
  it('opts 미주입 시 expiresAt 키 부재(회귀 0)', async () => {
    let captured: Record<string, unknown> = {}
    const store = { createRequest: async (r: Record<string, unknown>) => { captured = r; return { eventId: 'e' } } }
    await makeEscalationBrief(store)(INFO2)
    expect('expiresAt' in captured).toBe(false)
  })
})
