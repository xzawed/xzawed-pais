import type { StreamProducer } from '../streams/producer.js'
import type { UserContext } from '../types/user-context.js'
import { ensureWorkspace } from '../workspace.js'
import { produceDecomposition, type ProduceDeps } from './producer.js'
import { produceRiskClassification, type RiskClassifyDeps } from './risk-producer.js'
import { formatInconsistentReason, buildDecomposeFailureBrief } from '../streams/decompose-failure.js'
import type { DecisionRequestInput } from '../streams/decision-brief.js'

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
  decisionStore?: { createRequest(input: DecisionRequestInput): Promise<unknown> },
  ensureWs: (uc: UserContext) => Promise<void> = ensureWorkspace,
): Promise<void> {
  try {
    if (userContext !== undefined) {
      await ensureWs(userContext)
    }
    const { emitted, escalated } = await produceDecomposition(intent, sessionId, decompose, userContext)
    // P2r-3: 프로젝트 리스크 분류(best-effort·never-throw). decompose 결과와 무관.
    if (riskClassify !== undefined) {
      await produceRiskClassification(intent, sessionId, riskClassify, userContext).catch((err: unknown) =>
        // best-effort·분해 비차단이나 무로그 swallow는 상시 실패(전 워크플로 MEDIUM 고정 열화)를 감지 불가로 만든다.
        console.warn('[decompose] 리스크 분류 실패(best-effort·분해 비차단):', err),
      )
    }
    if (escalated) {
      // C7: producer escalation은 항상 coverage(repair 소진). escalation은 완료가 아니므로 error로 발행(재타이핑).
      await producer.publish({
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'error',
        payload: { agentId: 'manager', content: formatInconsistentReason('coverage') },
      })
      // C7 arm2: decisionStore 주입 + projectId 존재 시 decompose_inconsistent DecisionRequest(best-effort).
      const projectId = userContext?.projectId
      if (decisionStore && projectId) {
        try {
          await decisionStore.createRequest({
            ...buildDecomposeFailureBrief({ workflowId: sessionId, projectId, reason: 'coverage' }),
            tenantId: userContext?.tenantId ?? null,
          })
        } catch (err) {
          console.warn('[decompose] decompose_inconsistent 발행 실패(best-effort):', err)
        }
      }
    } else {
      await producer.publish({
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'task_complete',
        payload: { agentId: 'manager', content: `분해 완료: ${emitted} WP emitted` },
      })
    }
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
