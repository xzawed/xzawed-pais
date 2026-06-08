import type { WorkPackage } from '../types/work-package.js'
import { byId } from './order.js'

/** 기본 in-flight 상태(재기록 금지). draft/ready는 미착수 → 갱신 가능. */
const DEFAULT_INFLIGHT_STATUSES = new Set<WorkPackage['status']>(['in_progress', 'blocked', 'done'])

export interface MergeOptions {
  /**
   * 노드가 in-flight(진행 중이라 재기록 금지)인지. 기본: status ∈ {in_progress, blocked, done}.
   * 실 운영은 DB latestStates 기반 술어를 소비자가 주입(P1d-6 done 파생과 동형).
   */
  isInflight?: (wp: WorkPackage) => boolean
}

const defaultIsInflight = (wp: WorkPackage): boolean => DEFAULT_INFLIGHT_STATUSES.has(wp.status)

/**
 * §6 재진입 병합. incoming을 적용하되 existing의 in-flight 노드(+의존 폐포)는 보존(N4: 진행 중 재기록 금지).
 * content-hash id로 동일성 판정. 출력은 항상 buildTaskGraph 수용 가능(dangling 0). 출력 id 정렬.
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

  // 3) 보존 노드의 existing 의존 폐포 유지(dangling 0). incoming 의존은 incoming 자체 정합.
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
