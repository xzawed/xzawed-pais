import type { WorkPackage } from '../types/work-package.js'

/**
 * WP 의존성 그래프(DAG)의 불변 컨테이너. 노드 = WorkPackage(재사용), 엣지 = dependencies.
 * P1d Task Manager가 ready 노드를 결정론적으로 산출하는 토대. 순수 자료구조(I/O·부수효과 0).
 */
export interface TaskGraph {
  /** id → WorkPackage. 삽입 순서 보존(위상정렬 순서와는 별개). */
  readonly nodes: ReadonlyMap<string, WorkPackage>
  /** id → 직접 의존(선행) id 집합 = wp.dependencies. */
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>
  /** id → 이 노드를 의존하는 후행 id 집합(역인접). */
  readonly dependents: ReadonlyMap<string, ReadonlySet<string>>
}

/**
 * WorkPackage[] → TaskGraph. 인접/역인접 인덱스를 빌드한다.
 * 입력 무결성 위반만 throw — 중복 id, dangling dependency(미존재 id 참조).
 * 사이클은 throw하지 않는다(detectCycle·topoSort가 데이터로 보고).
 */
export function buildTaskGraph(wps: WorkPackage[]): TaskGraph {
  const nodes = new Map<string, WorkPackage>()
  for (const w of wps) {
    if (nodes.has(w.id)) {
      throw new Error(`buildTaskGraph: duplicate work package id: ${w.id}`)
    }
    nodes.set(w.id, w)
  }

  const dependencies = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()
  for (const id of nodes.keys()) {
    dependencies.set(id, new Set())
    dependents.set(id, new Set())
  }

  for (const w of wps) {
    for (const dep of w.dependencies) {
      if (!nodes.has(dep)) {
        throw new Error(`buildTaskGraph: unknown dependency "${dep}" referenced by "${w.id}"`)
      }
      dependencies.get(w.id)!.add(dep)
      dependents.get(dep)!.add(w.id)
    }
  }

  return { nodes, dependencies, dependents }
}
