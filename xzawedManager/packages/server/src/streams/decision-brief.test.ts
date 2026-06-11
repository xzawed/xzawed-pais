import { describe, it, expect, vi } from 'vitest'
import { buildDefectBrief, makeEscalationBrief, type DecisionBriefStore } from './decision-brief.js'

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
