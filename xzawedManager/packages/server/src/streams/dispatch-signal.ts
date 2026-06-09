import { z } from 'zod'
import { makeEnvelope, EventEnvelopeSchema } from '@xzawed/agent-streams'
import type { Publish } from './decomposition-consumer.js'

/** 워커 트리거 신호 스트림(공유·잠정·DEFAULT_CHANNEL='main'). dispatch/reclaim → WorkerConsumer. */
export const DISPATCH_SIGNAL_STREAM = 'manager:dispatched:main'
export const WP_DISPATCH_SIGNAL = 'wp.dispatch_signal'

/** 워커 트리거 신호. workflowId는 봉투, wpId·attempt는 payload(완료-신호 CompletionSignalSchema 동형). */
export const WpDispatchSignalSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.literal(WP_DISPATCH_SIGNAL),
  payload: z.object({ wpId: z.string().min(1), attempt: z.number().int().nonnegative() }),
})
export type WpDispatchSignalMessage = z.infer<typeof WpDispatchSignalSchema>

/**
 * 트리거 신호 발행(best-effort·outbox 미경유, lease가 신뢰성 백스톱). 멱등키를 (wf,wpId,attempt)에 고정 —
 * stepId에 wpId 포함 필수(미포함 시 같은 wf·attempt의 여러 WP가 키 충돌). dispatch(attempt=0)·reclaim(attempt++) 공유.
 */
export async function publishDispatchSignal(
  publish: Publish, workflowId: string, wpId: string, attempt: number, now: number = Date.now(),
): Promise<void> {
  const envelope = makeEnvelope(
    { correlationId: workflowId, causationId: null, workflowId, stepId: `${WP_DISPATCH_SIGNAL}:${wpId}`, attemptId: attempt },
    now,
  )
  await publish(DISPATCH_SIGNAL_STREAM, { envelope, type: WP_DISPATCH_SIGNAL, payload: { wpId, attempt } })
}
