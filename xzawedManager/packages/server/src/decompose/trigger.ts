import type { StreamProducer } from '../streams/producer.js'
import type { UserContext } from '../types/user-context.js'
import { ensureWorkspace } from '../workspace.js'
import { produceDecomposition, type ProduceDeps } from './producer.js'
import { produceRiskClassification, type RiskClassifyDeps } from './risk-producer.js'

/**
 * decompose_request 처리 글루: (P4a-2) 워크스페이스 보장 → 분해 생산(→decomposition.emitted) →
 * P2r-3 리스크 분류 best-effort → task_complete 발행 → cleanup.
 * cleanup은 finally로 보장(워크스페이스 검증·생산·발행 실패 시에도 세션 정리).
 * 호출자(sessions.route)가 flag 게이트. ensureWs는 테스트 주입용(기본 실 구현 — task_request 경로와 대칭).
 */
export async function handleDecomposeRequest(
  sessionId: string,
  intent: string,
  decompose: ProduceDeps,
  producer: Pick<StreamProducer, 'publish'>,
  cleanup: () => Promise<void>,
  userContext?: UserContext,
  riskClassify?: RiskClassifyDeps,
  ensureWs: (uc: UserContext) => Promise<void> = ensureWorkspace,
): Promise<void> {
  try {
    if (userContext !== undefined) {
      await ensureWs(userContext)
    }
    const { emitted, escalated } = await produceDecomposition(intent, sessionId, decompose, userContext)
    // P2r-3: 프로젝트 리스크 분류(best-effort·never-throw·미승인 pending). decompose 결과와 무관.
    if (riskClassify !== undefined) {
      // P2r-3 best-effort: 리스크 분류 실패가 분해 경로(task_complete·M8)를 절대 깨지 않도록 구조적으로 격리.
      // produceRiskClassification은 never-throw 계약이지만 여기서 한 번 더 차단(계약 위반·향후 변경 방어).
      await produceRiskClassification(intent, sessionId, riskClassify, userContext).catch(() => undefined)
    }
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
  } catch (err) {
    // M8 무음 통과 금지: 실패(워크스페이스 검증·발행 등)를 요청자에게 error로 알린 뒤 재던진다
    // (task_request 경로 대칭 — 미발행 시 세션이 응답 없이 해체돼 무한 대기). 에러 발행 자체가
    // 실패하면 원 오류 보존을 우선한다(호출자 .catch가 로그).
    const content = err instanceof Error ? err.message : String(err)
    await producer.publish({
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'error',
      payload: { agentId: 'manager', content },
    }).catch(() => undefined)
    throw err
  } finally {
    await cleanup()
  }
}
