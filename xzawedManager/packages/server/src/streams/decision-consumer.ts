import { z, type ZodType } from 'zod'
import type { Redis } from 'ioredis'
import { BaseConsumer, EventEnvelopeSchema } from '@xzawed/agent-streams'
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

const RecordedPayloadSchema = z.object({ requestId: z.string().min(1), choice: z.string(), decisionId: z.string().optional(), decidedBy: z.string().optional() })

export interface DecisionRoutingDeps {
  decisionStore: { getRequest(requestId: string): Promise<DecisionRequest | null> }
  leaseStore: { reopenLease(input: { workflowId: string; wpId: string; visibilityMs: number; causationId?: string | null }): Promise<ReopenResult> }
  publish: Publish
  visibilityMs: number
  now?: () => number
  /** P5-2a: accept_known on degraded_release → 사인오프(휴면 recordSignOff 활성). 미주입이면 no-op. */
  signoffStore?: { recordSignOff(input: { signoffId: string; decisionId: string; scope: string; approver: string; risk?: string; reason?: string | null }): Promise<{ eventId: string } | null> }
}

/**
 * decision.recorded 소비 → §11 되먹임. fix_reverify는 escalated WP lease 재오픈→dispatch_signal 재발행.
 * accept_known + degraded_release는 signoffStore 주입 시 사인오프 영속(P5-2a).
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
        if (req?.type !== 'degraded_release') return
        await deps.signoffStore.recordSignOff({
          signoffId: `${p.data.decisionId}:signoff`,
          decisionId: p.data.decisionId,
          scope: 'release',
          approver: p.data.decidedBy,
          risk: 'HIGH',
          reason: '릴리스 게이트 차단 사인오프',
        })
      }
    } catch (err) {
      console.warn('[decision-consumer] 라우팅 실패(best-effort·결정은 영속됨):', err)
    }
  }
}

/** decision.recorded 소비자(BaseConsumer·dedup ON). start('main') → manager:decision:main. */
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
    )
  }
}
