import { describe, it, expect } from 'vitest'
import { formatInconsistentReason, buildDecomposeFailureBrief } from './decompose-failure.js'

describe('formatInconsistentReason', () => {
  it('cycle 메시지', () => {
    expect(formatInconsistentReason('cycle')).toContain('순환 의존')
  })
  it('structural 메시지 + detail 부착', () => {
    const msg = formatInconsistentReason('structural', 'unknown dependency ghost')
    expect(msg).toContain('구조 오류')
    expect(msg).toContain('unknown dependency ghost')
  })
  it('coverage 메시지', () => {
    expect(formatInconsistentReason('coverage')).toContain('커버리지')
  })
  it('detail 500자 클램프', () => {
    const long = 'x'.repeat(600)
    const msg = formatInconsistentReason('structural', long)
    expect(msg.length).toBeLessThan(600 + 100)
  })
})

describe('buildDecomposeFailureBrief', () => {
  it('표준 DecisionRequestInput(멱등 requestId·type·options accept_known)', () => {
    const brief = buildDecomposeFailureBrief({ workflowId: 'wf-1', projectId: 'p1', reason: 'cycle' })
    expect(brief.requestId).toBe('wf-1:decompose-fail')
    expect(brief.type).toBe('decompose_inconsistent')
    expect(brief.workflowId).toBe('wf-1')
    expect(brief.correlationId).toBe('wf-1')
    expect(brief.projectId).toBe('p1')
    expect(brief.severity).toBe('blocking')
    expect(brief.wpId).toBeNull()
    expect(brief.context?.options).toEqual(['accept_known'])
  })
  it('detail이 expectedVsActual에 반영', () => {
    const brief = buildDecomposeFailureBrief({ workflowId: 'wf-2', projectId: 'p2', reason: 'structural', detail: 'dup id' })
    expect(brief.context?.expectedVsActual).toContain('dup id')
  })
})
