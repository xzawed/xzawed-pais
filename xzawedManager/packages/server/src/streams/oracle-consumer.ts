import { z } from 'zod'
import { EventEnvelopeSchema } from '@xzawed/agent-streams'
import { handleDispatch, type DispatchDeps } from './dispatch.js'
import { ORACLE_APPROVED_EVENT } from '../db/oracle.types.js'

/** oracle.approved 이벤트 스키마(supervisor oracleConsumer 입력). workflowId는 봉투·payload 양쪽. */
export const OracleApprovedSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.literal(ORACLE_APPROVED_EVENT),
  payload: z.object({
    oracleId: z.string().min(1),
    workflowId: z.string().min(1),
    storyId: z.string().min(1),
    version: z.number().int().positive(),
  }),
})
export type OracleApprovedMessage = z.infer<typeof OracleApprovedSchema>

/** 승인 이벤트 소비: handleDispatch로 재디스패치(satisfied-set이 새 승인 반영). completion 핸들러 대칭. */
export function buildOracleApprovedHandler(dispatch: DispatchDeps): (msg: OracleApprovedMessage) => Promise<void> {
  return async (msg) => {
    await handleDispatch(msg.envelope.workflowId, dispatch)
  }
}
