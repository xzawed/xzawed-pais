import type { StreamProducer } from '../streams/producer.js'
import { produceDecomposition, type ProduceDeps } from './producer.js'

/**
 * decompose_request 처리 글루: 분해 생산(→decomposition.emitted) → task_complete 발행 → cleanup.
 * cleanup은 finally로 보장(생산/발행 실패 시에도 세션 정리). 호출자(sessions.route)가 flag 게이트.
 */
export async function handleDecomposeRequest(
  sessionId: string,
  intent: string,
  decompose: ProduceDeps,
  producer: Pick<StreamProducer, 'publish'>,
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    const { emitted, escalated } = await produceDecomposition(intent, sessionId, decompose)
    const content = escalated
      ? '분해 불일치: 커버리지 수렴 실패 — 사람 검토 필요(에스컬레이션)'
      : `분해 완료: ${emitted} WP emitted`
    await producer.publish({
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'task_complete',
      payload: { agentId: 'manager', content },
    })
  } finally {
    await cleanup()
  }
}
