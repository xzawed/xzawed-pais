import { describe, it, expect } from 'vitest'
import { buildOracleBrief } from './oracle-brief.js'

describe('buildOracleBrief (C3 오라클 승인)', () => {
  it('oracle_approval DecisionRequest로 매핑', () => {
    const b = buildOracleBrief({ workflowId: 'wf-1', projectId: 'proj-1', storyCount: 3 })
    expect(b.type).toBe('oracle_approval')
    expect(b.requestId).toBe('wf-1:oracle')
    expect(b.workflowId).toBe('wf-1')
    expect(b.correlationId).toBe('wf-1')
    expect(b.wpId).toBeNull()
    expect(b.severity).toBe('blocking')
    expect(b.projectId).toBe('proj-1')
    expect(b.context?.options).toEqual(['approve', 'reject'])
    expect(b.context?.location).toContain('3')
  })
  it('projectId null 전파', () => {
    expect(buildOracleBrief({ workflowId: 'w', projectId: null, storyCount: 1 }).projectId).toBeNull()
  })
  it('requestId는 {wf}:oracle 결정론(멱등)', () => {
    expect(buildOracleBrief({ workflowId: 'wf-2', projectId: null, storyCount: 5 }).requestId).toBe('wf-2:oracle')
  })
})
