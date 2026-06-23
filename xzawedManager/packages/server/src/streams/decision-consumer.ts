import { z, type ZodType } from 'zod'
import type { Redis } from 'ioredis'
import { BaseConsumer, EventEnvelopeSchema, defaultDedupKey } from '@xzawed/agent-streams'
import { DECISION_RECORDED_EVENT, type DecisionRequest } from '../db/decision.types.js'
import { publishDispatchSignal } from './dispatch-signal.js'
import type { Publish } from './decomposition-consumer.js'
import type { ReopenResult } from '../db/lease.repo.js'

const DECISION_GROUP = 'manager-decision-consumers'
const DECISION_PREFIX = 'manager:decision'

/** 느슨한 봉투 스키마 — manager:decision:main의 모든 decision.* 이벤트 통과. 핸들러가 type으로 분기
 *  (recorded만 처리) — 다른 type을 invalid_schema DLQ로 보내지 않기 위함. */
export const DecisionEventSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.string(),
  payload: z.record(z.unknown()),
})
export type DecisionEventMessage = z.infer<typeof DecisionEventSchema>

/** B1 동시성: 같은 manager:decision:main 스트림을 두 소비자 그룹이 구독한다. BaseConsumer 멱등 마커
 *  idem:{stream}:{key}에는 그룹 성분이 없어 한 그룹이 다른 그룹의 마커를 선점하면(no-op type이어도)
 *  상대 그룹이 handler를 건너뛴다. dedup 키를 그룹으로 네임스페이싱해 두 그룹의 마커를 분리한다.
 *  ⚠️ redrive 불변식: 이 스트림의 DLQ 재처리(redriveDlq)는 un-scoped `idem:{stream}:{k}`를 삭제하므로
 *  group-scoped 마커를 못 지운다. 현재 안전한 이유는 두 핸들러가 never-throw라 handler_failed DLQ(마커가
 *  설정되는 유일 경로)가 도달 불가하고 invalid_schema DLQ는 isDuplicate 전에 발생하기 때문이다. 향후
 *  핸들러에 throw 경로를 추가하면 redrive가 group-scoped 마커에 막힐 수 있으니 그때 redrive를 그룹 인식으로 확장할 것. */
export function groupScopedDedupKey(group: string, msg: DecisionEventMessage): string | null {
  const k = defaultDedupKey(msg)
  return k === null ? null : `${group}:${k}`
}

const RecordedPayloadSchema = z.object({ requestId: z.string().min(1), choice: z.string(), decisionId: z.string().optional(), decidedBy: z.string().optional() })

export interface DecisionRoutingDeps {
  decisionStore: { getRequest(requestId: string): Promise<DecisionRequest | null> }
  leaseStore: { reopenLease(input: { workflowId: string; wpId: string; visibilityMs: number; causationId?: string | null }): Promise<ReopenResult> }
  publish: Publish
  visibilityMs: number
  now?: () => number
  /** P5-2a: accept_known on degraded_release → 사인오프(휴면 recordSignOff 활성). 미주입이면 no-op. */
  signoffStore?: { recordSignOff(input: { signoffId: string; decisionId: string; scope: string; approver: string; risk?: string; reason?: string | null }): Promise<{ eventId: string } | null> }
  /** C5: approve on risk_classification → RiskClassificationRepo.approve(실 비부인 decidedBy). 미주입이면 no-op. */
  riskStore?: { approve(workflowId: string, approvedBy: string): Promise<{ eventId: string } | null> }
  /** C3: approve on oracle_approval → 그 workflow pending 오라클 전부 승인. Slice 1: approve on golden_diff →
   *  그 workflow golden 전부 freeze(사인오프). 미주입이면 no-op. */
  oracleStore?: {
    approvePendingByWorkflow(workflowId: string, approvedBy: string): Promise<{ approved: number }>
    freezeGoldensByWorkflow?(workflowId: string, frozenBy: string): Promise<{ frozen: number }>
  }
  /** N2: accept_known on degraded_dispatch → 사인오프 후 재디스패치(handleDispatch 재실행·승인 WP 통과). 미주입이면 no-op. */
  redispatch?: (workflowId: string) => Promise<void>
}

/**
 * decision.recorded 소비 → §11 되먹임. fix_reverify는 escalated WP lease 재오픈→dispatch_signal 재발행.
 * accept_known + degraded_release는 signoffStore 주입 시 사인오프 영속(P5-2a).
 * approve + risk_classification는 riskStore 주입 시 위험분류 승인 영속(C5).
 * 다른/미지 choice는 no-op(폐루프 미차단). never-throw(어떤 실패도 흡수).
 */
export function buildDecisionRecordedHandler(deps: DecisionRoutingDeps): (msg: DecisionEventMessage) => Promise<void> {
  return async (msg) => {
    try {
      if (msg.type !== DECISION_RECORDED_EVENT) return
      const p = RecordedPayloadSchema.safeParse(msg.payload)
      if (!p.success) return
      if (p.data.choice === 'fix_reverify') {
        const req = await deps.decisionStore.getRequest(p.data.requestId)
        if (!req?.wpId) return
        const r = await deps.leaseStore.reopenLease({ workflowId: req.workflowId, wpId: req.wpId, visibilityMs: deps.visibilityMs, causationId: p.data.requestId })
        if (r.status !== 'reopened') return
        await publishDispatchSignal(deps.publish, req.workflowId, req.wpId, r.attempt, deps.now?.() ?? Date.now())
        return
      }
      if (p.data.choice === 'accept_known' && deps.signoffStore && p.data.decisionId && p.data.decidedBy) {
        const req = await deps.decisionStore.getRequest(p.data.requestId)
        if (req?.type === 'degraded_release') {
          await deps.signoffStore.recordSignOff({
            signoffId: `${p.data.decisionId}:signoff`, decisionId: p.data.decisionId,
            scope: 'release', approver: p.data.decidedBy, risk: 'HIGH', reason: '릴리스 게이트 차단 사인오프',
          })
        } else if (req?.type === 'degraded_dispatch') {
          await deps.signoffStore.recordSignOff({
            signoffId: `${p.data.decisionId}:signoff`, decisionId: p.data.decisionId,
            scope: 'degraded_dispatch', approver: p.data.decidedBy, risk: 'HIGH', reason: '강등 모드 HIGH-risk 디스패치 사인오프',
          })
          await deps.redispatch?.(req.workflowId)
        }
      }
      if (p.data.choice === 'approve' && p.data.decidedBy) {
        const req = await deps.decisionStore.getRequest(p.data.requestId)
        if (req?.type === 'risk_classification' && deps.riskStore) {
          await deps.riskStore.approve(req.workflowId, p.data.decidedBy)
        } else if (req?.type === 'oracle_approval' && deps.oracleStore) {
          await deps.oracleStore.approvePendingByWorkflow(req.workflowId, p.data.decidedBy)
        } else if (req?.type === 'golden_diff' && deps.oracleStore?.freezeGoldensByWorkflow) {
          await deps.oracleStore.freezeGoldensByWorkflow(req.workflowId, p.data.decidedBy)
        }
      }
    } catch (err) {
      console.warn('[decision-consumer] 라우팅 실패(best-effort·결정은 영속됨):', err)
    }
  }
}

/** decision.recorded 소비자(BaseConsumer·dedup ON·그룹-스코프 dedup 키). start('main') → manager:decision:main. */
export class DecisionRecordedConsumer extends BaseConsumer<DecisionEventMessage> {
  constructor(redis: Redis, deps: DecisionRoutingDeps, sleep?: (ms: number) => Promise<void>) {
    super(
      redis,
      buildDecisionRecordedHandler(deps),
      DECISION_GROUP,
      `manager-decision-${process.pid}`,
      DECISION_PREFIX,
      DecisionEventSchema as ZodType<DecisionEventMessage>,
      sleep,
      true,
      3,
      { key: (m) => groupScopedDedupKey(DECISION_GROUP, m) },
    )
  }
}
