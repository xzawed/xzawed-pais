import { describe, it, expect, vi } from 'vitest'
import { buildRiskApprovedHandler, RiskApprovedSchema } from './risk-consumer.js'

const envelope = {
  eventId: '550e8400-e29b-41d4-a716-446655440000', correlationId: 'wf-1', causationId: null, workflowId: 'wf-1',
  stepId: 'risk.approved:wf-1', attemptId: 1, idempotencyKey: 'k1', occurredAt: 1,
}
const msg = {
  envelope, type: 'risk.approved',
  payload: { workflowId: 'wf-1', projectId: 'p', risk: 'HIGH', version: 1, modelRouting: { PM: 'opus', Developer: 'opus', Designer: 'opus', Tester: 'opus', Security: 'opus' } },
}

describe('RiskApprovedSchema', () => {
  it('유효한 risk.approved를 통과시킨다', () => {
    expect(RiskApprovedSchema.safeParse(msg).success).toBe(true)
  })
  it('잘못된 type을 거부한다', () => {
    expect(RiskApprovedSchema.safeParse({ ...msg, type: 'other' }).success).toBe(false)
  })
})

describe('buildRiskApprovedHandler', () => {
  it('updateWpRisks(workflowId, risk)를 호출한다', async () => {
    const graphStore = { updateWpRisks: vi.fn().mockResolvedValue({ updated: 3 }) }
    const handler = buildRiskApprovedHandler({ graphStore })
    await handler(msg as never)
    expect(graphStore.updateWpRisks).toHaveBeenCalledWith('wf-1', 'HIGH')
  })
})
