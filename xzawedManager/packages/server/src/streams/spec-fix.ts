import { produceDecomposition, type ProduceDeps } from '../decompose/producer.js'
import type { UserContext } from '../types/user-context.js'
import { normalizeIntent } from '../decompose/intent.js'

/** 재분해 입력에 실을 사람 피드백 상한 — 분해 프롬프트를 자유 텍스트가 잠식하지 않게. */
export const FEEDBACK_MAX = 2000

/** `TaskGraphRepo` 의 구조적 부분집합(M3 — repo 직접 결합 회피). */
export interface SpecFixGraphStore {
  getGraph(workflowId: string): Promise<{ intent: string | null; userContext: UserContext | null } | null>
}

export type SpecFixOutcome =
  | { status: 'redecomposed' }
  | { status: 'skipped'; reason: 'graph_not_found' | 'intent_not_stored' }

/**
 * **`spec_fix` → 재분해 입력 조립**(S7.2 / 결함 F6).
 *
 * 사람이 `spec_fix` 를 고르는 것은 "구현이 아니라 **스펙**이 틀렸다"는 뜻이다. 그러니 되먹임은
 * 같은 WP 를 다시 돌리는 것(`fix_reverify`)이 아니라 **분해를 다시 하는 것**이다.
 *
 * **피드백이 없으면 같은 입력이다.** 원 intent 만으로 재분해를 돌리면 같은 분해가 나올 뿐인
 * 루프가 된다 — 그래서 사람의 `justification` 을 스펙에 덧붙인 것을 새 입력으로 쓴다.
 * 덧붙인 결과가 다음 저장본이 된다: `spec_fix` 는 스펙을 **고치는** 것이므로 수정본이 정본이다.
 */
export function buildRedecomposeIntent(storedIntent: string, feedback: string | null): string {
  const f = feedback?.trim()
  if (!f) return storedIntent
  return `${storedIntent}\n\n[사람 피드백 — 스펙 수정 요청]\n${f.slice(0, FEEDBACK_MAX)}`
}

/**
 * `spec_fix` 재분해 핸들러. `decision-consumer` 의 `redecompose` 포트에 주입된다.
 *
 * **fail-closed 다.** 그래프가 없거나 분해 입력이 저장돼 있지 않으면(레거시 워크플로) 재분해하지
 * 않고 사유를 남긴다 — 빈 스펙으로 분해를 돌리면 워크플로의 WP 를 통째로 갈아엎는다.
 *
 * 재분해 결과는 `decomposition.emitted` 로 나가고, 소비자가 `mergeKeepInflight`(S6.2)로
 * **진행 중 WP 를 보존한 채** 병합한다 — 여기서 따로 보존 로직을 만들지 않는다.
 */
export function makeSpecFixRedecompose(
  store: SpecFixGraphStore,
  decompose: ProduceDeps,
): (workflowId: string, feedback: string | null) => Promise<SpecFixOutcome> {
  return async (workflowId, feedback) => {
    const graph = await store.getGraph(workflowId)
    if (!graph) {
      console.warn(`[spec-fix] ${workflowId}: 그래프 없음 — 재분해 생략`)
      return { status: 'skipped', reason: 'graph_not_found' }
    }
    // 저장소가 이미 걸러 주지만 여기서도 정규화한다 — 이 함수는 저장소 밖에서도 주입 가능한
    // 포트를 받으므로 스스로 판정할 수 있어야 한다.
    const stored = normalizeIntent(graph.intent)
    if (!stored) {
      // S7.2 이전에 만들어진 그래프에는 분해 입력이 없다. 추정해서 돌리지 않는다.
      console.warn(`[spec-fix] ${workflowId}: 분해 입력 미영속(레거시 그래프) — 재분해 생략`)
      return { status: 'skipped', reason: 'intent_not_stored' }
    }
    const intent = buildRedecomposeIntent(stored, feedback)
    await produceDecomposition(intent, workflowId, decompose, graph.userContext ?? undefined)
    return { status: 'redecomposed' }
  }
}
