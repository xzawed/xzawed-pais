import { describe, it, expect, vi } from 'vitest'
import { WpDispatchSignalSchema, publishDispatchSignal, DISPATCH_SIGNAL_STREAM, WP_DISPATCH_SIGNAL } from './dispatch-signal.js'

describe('dispatch-signal', () => {
  it('WpDispatchSignalSchema는 envelope+type+payload(wpId,attempt)를 파싱', () => {
    const env = { eventId: '11111111-1111-1111-1111-111111111111', correlationId: 'wf1', causationId: null, workflowId: 'wf1', stepId: 'wp.dispatch_signal:a', attemptId: 0, idempotencyKey: 'wf1:wp.dispatch_signal:a:0', occurredAt: 1 }
    const m = WpDispatchSignalSchema.parse({ envelope: env, type: WP_DISPATCH_SIGNAL, payload: { wpId: 'a', attempt: 0 } })
    expect(m.payload).toEqual({ wpId: 'a', attempt: 0 })
  })
  it('publishDispatchSignal은 공유 스트림에 신호 발행(멱등키 (wf,wpId,attempt) 고유)', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    await publishDispatchSignal(publish, 'wf1', 'a', 2, 1000)
    const [stream, msg] = publish.mock.calls[0]!
    expect(stream).toBe(DISPATCH_SIGNAL_STREAM)
    expect(msg).toMatchObject({ type: WP_DISPATCH_SIGNAL, payload: { wpId: 'a', attempt: 2 } })
    expect(msg.envelope.idempotencyKey).toBe('wf1:wp.dispatch_signal:a:2')
  })
  it('같은 wf·attempt라도 wpId가 다르면 멱등키가 다름(충돌 회피)', async () => {
    const publish = vi.fn().mockResolvedValue('1-0')
    await publishDispatchSignal(publish, 'wf1', 'a', 0, 1)
    await publishDispatchSignal(publish, 'wf1', 'b', 0, 1)
    const k1 = publish.mock.calls[0]![1].envelope.idempotencyKey
    const k2 = publish.mock.calls[1]![1].envelope.idempotencyKey
    expect(k1).not.toBe(k2)
  })
})
