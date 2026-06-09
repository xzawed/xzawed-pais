import { describe, it, expect, vi } from 'vitest'
import { buildOracleApprovedHandler, OracleApprovedSchema } from './oracle-consumer.js'

describe('buildOracleApprovedHandler', () => {
  it('oracle.approved → handleDispatch(envelope.workflowId)', async () => {
    const dispatch = { repo: { getGraph: vi.fn().mockResolvedValue(null), latestStates: vi.fn() }, store: {} }
    const handler = buildOracleApprovedHandler(dispatch as never)
    const msg = OracleApprovedSchema.parse({
      envelope: { eventId: '11111111-1111-1111-1111-111111111111', correlationId: 'wf1', causationId: null, workflowId: 'wf1', stepId: 'oracle.approved:o1', attemptId: 1, idempotencyKey: 'wf1:oracle.approved:o1:1', occurredAt: 1 },
      type: 'oracle.approved',
      payload: { oracleId: 'o1', workflowId: 'wf1', storyId: 's1', version: 1 },
    })
    await handler(msg)
    expect(dispatch.repo.getGraph).toHaveBeenCalledWith('wf1')
  })
})
