import type { TaskGraph } from './task-graph.js'

/**
 * 사이클에 속한 노드 경로 목록(없으면 []). DFS 백엣지 검출.
 * 사양 §6 "사이클 = 분해 오류"의 순수 탐지부. 수선(llm_break_cycle)은 소비 단계(P1d-2) 책임.
 *
 * ⚠️ 탐지 전용: 경로는 발견 순서대로의 노드 목록일 뿐 정규화(회전·중복 제거)하지 않는다.
 * 동일 논리 사이클이 그래프 빌드 순서에 따라 다른 시작 노드로 표현될 수 있으므로, 소비단에서
 * 경로를 키로 캐시/비교하지 말 것(결정론이 필요한 order/cyclic/readyNodes는 id 사전순으로 안정).
 */
export function detectCycle(graph: TaskGraph): string[][] {
  const cycles: string[][] = []
  // 0/undefined=미방문, 1=현재 스택(gray), 2=완료(black)
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []

  const visit = (id: string): void => {
    state.set(id, 1)
    stack.push(id)
    for (const dep of graph.dependencies.get(id) ?? []) {
      const s = state.get(dep)
      if (s === undefined) {
        visit(dep)
      } else if (s === 1) {
        const idx = stack.indexOf(dep)
        if (idx !== -1) cycles.push(stack.slice(idx))
      }
    }
    stack.pop()
    state.set(id, 2)
  }

  for (const id of graph.nodes.keys()) {
    if (state.get(id) === undefined) visit(id)
  }
  return cycles
}

/**
 * id 비교자(UTF-16 코드유닛·로케일 무관) — 같은 환경/다른 환경 모두 동일 순서 보장.
 * `localeCompare`는 런타임 로케일에 의존해 결정론(N4)을 깰 수 있으므로 의도적으로 미사용.
 */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Kahn 위상정렬. `order`=위상순서 id(결정론), `cyclic`=사이클로 정렬 못한 잔여 id.
 * 결정론 타이브레이크: in-degree 0 후보가 여럿이면 id 사전순 선택(입력 순서 무관).
 * 사이클이면 throw하지 않고 해당 노드를 cyclic으로 보고(N4 step-N 토대).
 */
export function topoSort(graph: TaskGraph): { order: string[]; cyclic: string[] } {
  const inDegree = new Map<string, number>()
  for (const id of graph.nodes.keys()) {
    inDegree.set(id, (graph.dependencies.get(id) ?? new Set()).size)
  }

  const order: string[] = []
  const ready = [...graph.nodes.keys()].filter((id) => inDegree.get(id) === 0).sort(byId)

  while (ready.length > 0) {
    const id = ready.shift()! // id 사전순 최소(ready는 정렬 유지)
    order.push(id)
    let added = false
    for (const dependent of graph.dependents.get(id) ?? []) {
      const d = (inDegree.get(dependent) ?? 0) - 1
      inDegree.set(dependent, d)
      if (d === 0) {
        ready.push(dependent)
        added = true
      }
    }
    if (added) ready.sort(byId)
  }

  const inOrder = new Set(order)
  const cyclic = [...graph.nodes.keys()].filter((id) => !inOrder.has(id))
  return { order, cyclic }
}
