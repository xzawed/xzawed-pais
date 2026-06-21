import { z } from 'zod'
import { EventEnvelopeSchema, WpRiskSchema } from '@xzawed/agent-streams'
import type { WpRisk } from '@xzawed/agent-streams'
import { RISK_APPROVED_EVENT } from '../db/risk-classification.types.js'

/** risk.approved 이벤트 스키마(RiskClassificationRepo.approve 발행). workflowId는 봉투·payload 양쪽. */
export const RiskApprovedSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.literal(RISK_APPROVED_EVENT),
  payload: z.object({
    workflowId: z.string().min(1),
    projectId: z.string(),
    risk: WpRiskSchema,
    version: z.number().int().positive(),
    modelRouting: z.record(z.string(), z.string()),
  }),
})
export type RiskApprovedMessage = z.infer<typeof RiskApprovedSchema>

/** write-back 대상의 좁은 포트(TaskGraphRepo 구조적 충족). */
export interface RiskWriteBackStore {
  updateWpRisks(workflowId: string, risk: WpRisk): Promise<{ updated: number }>
}

/** 승인 이벤트 소비: 승인된 risk를 graph WP들에 write-back(D4). 재디스패치 없음(risk는 readiness 무변). */
export function buildRiskApprovedHandler(deps: { graphStore: RiskWriteBackStore }): (msg: RiskApprovedMessage) => Promise<void> {
  return async (msg) => {
    await deps.graphStore.updateWpRisks(msg.payload.workflowId, msg.payload.risk)
  }
}
