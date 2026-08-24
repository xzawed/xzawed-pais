import type { WorkPackage } from '../types/work-package.js'
import { WP_INFLIGHT_STATES } from '../types/wp-state.js'
import { byId } from './order.js'

export interface MergeOptions {
  /**
   * 노드가 in-flight(진행 중이라 재기록 금지)인지.
   *
   * **기본값을 프로덕션에서 그대로 쓰면 안 된다.** 기본은 `wp.status ∈ WP_INFLIGHT_STATES` 인데,
   * `graph_dag` 의 status 는 프로덕션에서 영원히 `DRAFTED` 라 **항상 공집합**이다 —
   * 실제 진행 상태는 `wp_state_log` 에만 있다. 소비자가 `latestStates` 기반 술어를 주입해야 한다
   * (`streams/decomposition-consumer.ts` 가 그렇게 한다. `isDone` ← `doneSet` 과 같은 구조).
   */
  isInflight?: (wp: WorkPackage) => boolean
}

const defaultIsInflight = (wp: WorkPackage): boolean => WP_INFLIGHT_STATES.has(wp.status)

/**
 * §6 재진입 병합. incoming을 적용하되 existing의 in-flight 노드(+의존 폐포)는 보존(N4: 진행 중 재기록 금지).
 * content-hash id로 동일성 판정. 출력은 항상 buildTaskGraph 수용 가능(dangling 0). 출력 id 정렬.
 * @param existing 그 자체로 유효한 그래프(dangling dep 없음)여야 한다(전제). 위반 시 보존 노드의 폐포가 불완전해질 수 있다.
 */
export function mergeKeepInflight(
  existing: WorkPackage[],
  incoming: WorkPackage[],
  opts: MergeOptions = {},
): WorkPackage[] {
  const isInflight = opts.isInflight ?? defaultIsInflight
  const existingById = new Map(existing.map((w) => [w.id, w]))
  const incomingById = new Map(incoming.map((w) => [w.id, w]))

  const result = new Map<string, WorkPackage>()
  const preserved: WorkPackage[] = [] // existing에서 보존된 in-flight 노드(폐포 시드)

  // 1) incoming 적용: in-flight existing은 유지, 아니면 incoming 채택/추가
  for (const inc of incoming) {
    const ex = existingById.get(inc.id)
    if (ex && isInflight(ex)) {
      result.set(inc.id, ex)
      preserved.push(ex)
    } else {
      result.set(inc.id, inc)
    }
  }

  // 2) incoming에 없는 existing in-flight 노드 보존
  for (const ex of existing) {
    if (!incomingById.has(ex.id) && isInflight(ex)) {
      result.set(ex.id, ex)
      preserved.push(ex)
    }
  }

  // 3) 보존 노드의 existing 의존 폐포 유지(dangling 0).
  //    - 의존이 result에 이미 있으면 skip(incoming 버전 우선 — passes 1·2에서 설정됨).
  //    - 없으면 existing에서 보충(incoming에서 제거된 선행이 보존 노드를 고아로 만들지 않게).
  const queue = preserved.map((w) => w.id)
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = result.get(id)
    if (!node) continue
    for (const depId of node.dependencies) {
      if (result.has(depId)) continue
      const exDep = existingById.get(depId)
      if (exDep) {
        result.set(depId, exDep)
        queue.push(depId)
      }
    }
  }

  return [...result.values()].sort((a, b) => byId(a.id, b.id))
}
