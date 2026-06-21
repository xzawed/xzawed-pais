import { describe, it, expect } from 'vitest'
import { buildRiskBrief } from './risk-brief.js'
import { scoreClassification } from '@xzawed/agent-streams'

describe('buildRiskBrief', () => {
  it('RiskClassification을 risk_classification DecisionRequest 입력으로 매핑한다', () => {
    const classification = scoreClassification({
      projectId: 'proj-1',
      complianceFrameworks: ['HIPAA'],
      claims: [{ text: 'PHI', dimension: 'compliance', support: 3, citations: ['a', 'b', 'c'] }],
    })
    const brief = buildRiskBrief({ workflowId: 'wf-1', version: 2, classification })
    expect(brief.type).toBe('risk_classification')
    expect(brief.requestId).toBe('wf-1:risk:2')
    expect(brief.workflowId).toBe('wf-1')
    expect(brief.projectId).toBe('proj-1')
    expect(brief.context.options).toEqual(['approve', 'reject'])
    expect(brief.context.expectedVsActual).toContain('HIGH')
    expect(brief.context.evidenceRefs).toContain('HIPAA')
  })

  it('재채점(version++)은 다른 requestId', () => {
    const c = scoreClassification({
      projectId: 'p',
      claims: [{ text: 'x', dimension: 'domain', support: 1, citations: ['a'] }],
    })
    expect(
      buildRiskBrief({ workflowId: 'wf', version: 1, classification: c }).requestId,
    ).not.toBe(buildRiskBrief({ workflowId: 'wf', version: 2, classification: c }).requestId)
  })
})
