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
    const { emitted } = await produceDecomposition(intent, sessionId, decompose)
    await producer.publish({
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'task_complete',
      payload: { agentId: 'manager', content: `분해 완료: ${emitted} WP emitted` },
    })
  } finally {
    await cleanup()
  }
}
