import { describe, it, expect } from 'vitest'
import { buildGoldenBrief } from './golden-brief.js'

describe('buildGoldenBrief (Slice 1 golden_diff DecisionRequest)', () => {
  it('golden_diff·requestId={wf}:golden 멱등·표준 DecisionContext(C3 oracle-brief 미러)', () => {
    const b = buildGoldenBrief({ workflowId: 'wf-1', projectId: 'proj-1', goldenCount: 3 })
    expect(b.requestId).toBe('wf-1:golden')
    expect(b.type).toBe('golden_diff')
    expect(b.workflowId).toBe('wf-1')
    expect(b.correlationId).toBe('wf-1')
    expect(b.wpId).toBeNull()
    expect(b.severity).toBe('blocking')
    expect(b.projectId).toBe('proj-1')
    expect(b.context.options).toEqual(['approve', 'reject'])
    expect(b.context.impact).toEqual([])
    expect(b.context.evidenceRefs).toEqual([])
    expect(b.context.location).toContain('3')
  })

  it('projectId null 허용', () => {
    expect(buildGoldenBrief({ workflowId: 'wf-2', projectId: null, goldenCount: 1 }).projectId).toBeNull()
  })
})
