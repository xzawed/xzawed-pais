import { describe, it, expect, vi } from 'vitest'
import { buildGateBlockedHandler } from './release-consumer.js'

const blocked = {
  type: 'gate.blocked',
  payload: { workflowId: 'wf-1', gateVersion: 'v1', blockingReasons: ['r1'], perWp: [{ wpId: 'wp-a', proven: false, unverifiable: true, missingChannels: [] }] },
}

describe('buildGateBlockedHandler', () => {
  it('gate.blocked → onBlocked(SignoffBriefInfo)', async () => {
    const onBlocked = vi.fn().mockResolvedValue(undefined)
    await buildGateBlockedHandler({ onBlocked })(blocked as never)
    expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-1', gateVersion: 'v1', blockingReasons: ['r1'] }))
  })
  it('gate.passed는 무시(P5-2b)', async () => {
    const onBlocked = vi.fn()
    await buildGateBlockedHandler({ onBlocked })({ ...blocked, type: 'gate.passed' } as never)
    expect(onBlocked).not.toHaveBeenCalled()
  })
  it('페이로드 불량 → onBlocked 미호출(skip)', async () => {
    const onBlocked = vi.fn()
    await buildGateBlockedHandler({ onBlocked })({ type: 'gate.blocked', payload: { gateVersion: 'v1' } } as never)
    expect(onBlocked).not.toHaveBeenCalled()
  })
  it('onBlocked throw → never-throw(흡수)', async () => {
    const onBlocked = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(buildGateBlockedHandler({ onBlocked })(blocked as never)).resolves.toBeUndefined()
  })
})
