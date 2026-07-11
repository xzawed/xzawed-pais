import { z } from 'zod'
import { AttributionCountersSchema } from '@xzawed/agent-streams'

/**
 * M9 — 의사결정 브리프 & 사인오프 영속 스키마(HUMAN_DECISION_PERSISTENCE.md §3).
 * DecisionRequest = 사람 판단이 필요한 항목(가변 프로젝션·상태 전이). HumanDecision/SignOff = 사람 행동의
 * **불변 append-only 기록**(부인방지 M9·감사 M7). 진실원천은 manager_events(decision.* / signoff.*).
 */

// 생명주기 이벤트 타입(단일출처). request·expire·supersede는 시스템 액터, recorded/signoff는 사람 액터.
export const DECISION_REQUESTED_EVENT = 'decision.requested'
export const DECISION_RECORDED_EVENT = 'decision.recorded'
export const SIGNOFF_RECORDED_EVENT = 'signoff.recorded'
export const DECISION_EXPIRED_EVENT = 'decision.expired'
export const DECISION_SUPERSEDED_EVENT = 'decision.superseded'
/** 시스템이 일으킨 결정 생명주기 이벤트의 actor(사람 결정은 decided_by/approver를 actor로). */
export const DECISION_ACTOR = 'decision-gate'
/** decision.* 소비 스트림(잠정 — Supervisor :main 채널 모델). 봉투에 workflowId. */
export const DECISION_STREAM = 'manager:decision:main'

// DecisionRequest 상태머신(§2): PENDING → RESOLVED | EXPIRED | SUPERSEDED.
export const DECISION_PENDING = 'PENDING'
export const DECISION_RESOLVED = 'RESOLVED'
export const DECISION_EXPIRED = 'EXPIRED'
export const DECISION_SUPERSEDED = 'SUPERSEDED'

/** §11 결함 귀속 계층. 첫 슬라이스는 impl 소진 단일 값(P6서 task/plan 승급 추가). */
export const FaultTierSchema = z.enum(['impl_exhausted'])
export type FaultTier = z.infer<typeof FaultTierSchema>

/** §11 결함 국소화 라벨 — 어느 계층이 소진됐는지 + 계약사슬 3계층 카운터(work-package §7 재사용). */
export const FaultAttributionSchema = z.object({
  faultTier: FaultTierSchema,
  counters: AttributionCountersSchema,
})
export type FaultAttribution = z.infer<typeof FaultAttributionSchema>

/** §3 결함 의사결정 브리프 컨텍스트(위치·기대 vs 실제·영향·증거·선택지). */
export const DecisionContextSchema = z
  .object({
    location: z.string().optional(),
    expectedVsActual: z.string().optional(),
    impact: z.array(z.string()).default([]),
    evidenceRefs: z.array(z.string()).default([]),
    options: z.array(z.string()).default([]),
    /** §11 결함 국소화 라벨(P4 4c). escalate 시 buildDefectBrief가 채움. */
    attribution: FaultAttributionSchema.optional(),
  })
  .default({})
export type DecisionContext = z.infer<typeof DecisionContextSchema>

export const DecisionRequestSchema = z.object({
  requestId: z.string().min(1),
  type: z.enum(['defect_brief', 'conformance_review', 'gate_override', 'degraded_release', 'oracle_approval', 'golden_diff', 'safe_resume', 'risk_classification', 'degraded_dispatch', 'decompose_inconsistent']),
  workflowId: z.string().min(1),
  wpId: z.string().nullable().default(null),
  /** 워크플로 이벤트 로그(spec §16) 상관키 — 보통 workflowId. */
  correlationId: z.string().min(1),
  /** C0/C1: 프로젝트 스코프(생성 시점 graph_dag.userContext.projectId). legacy/미해석은 null. */
  projectId: z.string().nullable().default(null),
  context: DecisionContextSchema,
  severity: z.enum(['blocking', 'advisory']).default('blocking'),
  status: z.enum(['PENDING', 'RESOLVED', 'EXPIRED', 'SUPERSEDED']).default('PENDING'),
  /** 사람 대면 한국어, 저장 메타는 영어(§4·§6). */
  language: z.string().default('ko'),
  expiresAt: z.string().nullable().default(null),
})
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>

/** §3 HumanDecision — 사람 행동의 불변 기록. causation_id = request_id(§3 인과 체인 M7). */
export const HumanDecisionSchema = z.object({
  decisionId: z.string().min(1),
  requestId: z.string().min(1),
  decidedBy: z.string().min(1),
  authority: z.string().nullable().default(null),
  choice: z.enum(['fix_reverify', 'spec_fix', 'accept_known', 'reject', 'approve', 'resume']),
  justification: z.string().nullable().default(null),
  routedTo: z.enum(['impl', 'task', 'plan', 'gate_override', 'oracle_refine', 'saga_rollback', 'risk_approve']).nullable().default(null),
})
export type HumanDecision = z.infer<typeof HumanDecisionSchema>

/** §3 SignOff — 위험을 알면서 승인하는 특수 결정(강등 릴리스·기술부채 수용). 불변·비부인(N2). */
export const SignOffSchema = z.object({
  signoffId: z.string().min(1),
  decisionId: z.string().min(1),
  scope: z.string().min(1),
  risk: z.string().default('HIGH'),
  reason: z.string().nullable().default(null),
  approver: z.string().min(1),
  authorityLevel: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  techDebtRef: z.string().nullable().default(null),
})
export type SignOff = z.infer<typeof SignOffSchema>
