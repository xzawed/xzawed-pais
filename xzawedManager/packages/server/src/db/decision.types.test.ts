import { describe, it, test, expect } from 'vitest'
import {
  DecisionRequestSchema, HumanDecisionSchema, SignOffSchema,
  DecisionContextSchema, FaultAttributionSchema,
  DECISION_PENDING,
  DECISION_REQUESTED_EVENT, DECISION_RECORDED_EVENT, SIGNOFF_RECORDED_EVENT,
  DECISION_EXPIRED_EVENT, DECISION_SUPERSEDED_EVENT, DECISION_STREAM, DECISION_ACTOR,
} from './decision.types.js'

describe('DecisionRequestSchema (HUMAN_DECISION_PERSISTENCE §3)', () => {
  it('parses a minimal request with defaults (PENDING·blocking·ko·null·empty context)', () => {
    const r = DecisionRequestSchema.parse({
      requestId: 'req-1', type: 'defect_brief', workflowId: 'wf1', correlationId: 'wf1',
    })
    expect(r.status).toBe(DECISION_PENDING)
    expect(r.severity).toBe('blocking')
    expect(r.language).toBe('ko')
    expect(r.wpId).toBeNull()
    expect(r.expiresAt).toBeNull()
    expect(r.context).toEqual({ impact: [], evidenceRefs: [], options: [] })
  })

  it('rejects an unknown decision type', () => {
    expect(() => DecisionRequestSchema.parse({ requestId: 'r', type: 'bogus', workflowId: 'wf', correlationId: 'wf' })).toThrow()
  })

  it('accepts all seven §3 decision types', () => {
    for (const type of ['defect_brief', 'conformance_review', 'gate_override', 'degraded_release', 'oracle_approval', 'golden_diff', 'safe_resume']) {
      expect(DecisionRequestSchema.parse({ requestId: 'r', type, workflowId: 'wf', correlationId: 'wf' }).type).toBe(type)
    }
  })

  it('preserves a full context (location·expectedVsActual·impact·evidenceRefs·options)', () => {
    const r = DecisionRequestSchema.parse({
      requestId: 'r', type: 'gate_override', workflowId: 'wf', correlationId: 'wf',
      context: { location: 'wp-7', expectedVsActual: 'exp vs act', impact: ['s1'], evidenceRefs: ['ev1'], options: ['fix', 'reject'] },
    })
    expect(r.context.location).toBe('wp-7')
    expect(r.context.impact).toEqual(['s1'])
    expect(r.context.options).toEqual(['fix', 'reject'])
  })

  it('rejects severity outside {blocking, advisory}', () => {
    expect(() => DecisionRequestSchema.parse({ requestId: 'r', type: 'defect_brief', workflowId: 'wf', correlationId: 'wf', severity: 'urgent' })).toThrow()
  })
})

describe('HumanDecisionSchema (§3 immutable record)', () => {
  it('parses with nullable defaults (authority·justification·routedTo null)', () => {
    const d = HumanDecisionSchema.parse({ decisionId: 'd1', requestId: 'req-1', decidedBy: 'human-1', choice: 'approve' })
    expect(d.authority).toBeNull()
    expect(d.justification).toBeNull()
    expect(d.routedTo).toBeNull()
  })

  it('rejects an unknown choice', () => {
    expect(() => HumanDecisionSchema.parse({ decisionId: 'd', requestId: 'r', decidedBy: 'h', choice: 'maybe' })).toThrow()
  })

  it('accepts all six §4 choices', () => {
    for (const choice of ['fix_reverify', 'spec_fix', 'accept_known', 'reject', 'approve', 'resume']) {
      expect(HumanDecisionSchema.parse({ decisionId: 'd', requestId: 'r', decidedBy: 'h', choice }).choice).toBe(choice)
    }
  })

  it('accepts all six §4 routedTo targets', () => {
    for (const routedTo of ['impl', 'task', 'plan', 'gate_override', 'oracle_refine', 'saga_rollback']) {
      expect(HumanDecisionSchema.parse({ decisionId: 'd', requestId: 'r', decidedBy: 'h', choice: 'fix_reverify', routedTo }).routedTo).toBe(routedTo)
    }
  })
})

describe('SignOffSchema (§3 risk acceptance, non-repudiable)', () => {
  it('parses with defaults (risk HIGH·nullable fields null)', () => {
    const s = SignOffSchema.parse({ signoffId: 'so1', decisionId: 'd1', scope: 'release X', approver: 'human-1' })
    expect(s.risk).toBe('HIGH')
    expect(s.reason).toBeNull()
    expect(s.authorityLevel).toBeNull()
    expect(s.expiresAt).toBeNull()
    expect(s.techDebtRef).toBeNull()
  })

  it('requires scope and approver', () => {
    expect(() => SignOffSchema.parse({ signoffId: 'so1', decisionId: 'd1', approver: 'h' })).toThrow()
    expect(() => SignOffSchema.parse({ signoffId: 'so1', decisionId: 'd1', scope: 's' })).toThrow()
  })
})

describe('DecisionContext attribution (P4 4c)', () => {
  test('FaultAttributionSchema: faultTier + counters 파싱', () => {
    const a = FaultAttributionSchema.parse({ faultTier: 'impl_exhausted', counters: { impl: 3, task: 0, plan: 0 } })
    expect(a.faultTier).toBe('impl_exhausted')
    expect(a.counters).toEqual({ impl: 3, task: 0, plan: 0 })
  })
  test('DecisionContextSchema: attribution 라운드트립', () => {
    const c = DecisionContextSchema.parse({ attribution: { faultTier: 'impl_exhausted', counters: { impl: 1, task: 0, plan: 0 } } })
    expect(c.attribution?.faultTier).toBe('impl_exhausted')
  })
  test('DecisionContextSchema: attribution 미지정 시 undefined(backward-compat)', () => {
    const c = DecisionContextSchema.parse({ location: 'WP x' })
    expect(c.attribution).toBeUndefined()
  })
})

describe('constants (single source for event types·stream·actor)', () => {
  it('exposes decision lifecycle event types', () => {
    expect(DECISION_REQUESTED_EVENT).toBe('decision.requested')
    expect(DECISION_RECORDED_EVENT).toBe('decision.recorded')
    expect(SIGNOFF_RECORDED_EVENT).toBe('signoff.recorded')
    expect(DECISION_EXPIRED_EVENT).toBe('decision.expired')
    expect(DECISION_SUPERSEDED_EVENT).toBe('decision.superseded')
  })

  it('exposes the decision outbox stream and system actor', () => {
    expect(DECISION_STREAM).toBe('manager:decision:main')
    expect(DECISION_ACTOR).toBe('decision-gate')
  })
})
