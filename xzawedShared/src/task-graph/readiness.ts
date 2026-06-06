import type { WorkPackage } from '../types/work-package.js'
import type { TaskGraph } from './task-graph.js'
import { topoSort } from './topo-sort.js'

/** readiness(DoR) 판정 주입점. 기본은 work-package 필드 기반. */
export interface ReadinessOptions {
  /** 노드가 done인지. 기본: `wp.status === 'done'`(외부 done-set 주입 가능). */
  isDone?: (wp: WorkPackage) => boolean
  /** 오라클 충족 여부(DoR). 기본: `wp.oracleRef != null`. P3 Oracle 스키마 도착 시 술어만 교체. */
  oracleSatisfied?: (wp: WorkPackage) => boolean
}

const defaultIsDone = (wp: WorkPackage): boolean => wp.status === 'done'
const defaultOracleSatisfied = (wp: WorkPackage): boolean => wp.oracleRef != null

/**
 * DoR(Definition of Ready) 가드: 모든 dependency가 done AND 오라클 충족 AND 자신이 아직 done 아님.
 * status enum 전이는 읽지 않는다(상태머신 드리프트 회피) — done 여부는 isDone 술어로만 판정.
 */
export function isReady(wp: WorkPackage, graph: TaskGraph, opts: ReadinessOptions = {}): boolean {
  const isDone = opts.isDone ?? defaultIsDone
  const oracleSatisfied = opts.oracleSatisfied ?? defaultOracleSatisfied

  if (isDone(wp)) return false
  if (!oracleSatisfied(wp)) return false

  for (const depId of graph.dependencies.get(wp.id) ?? []) {
    const dep = graph.nodes.get(depId)
    if (!dep || !isDone(dep)) return false
  }
  return true
}

/**
 * ready 노드 id 목록. topoSort order(결정론) 순서로 isReady인 것만 반환.
 * 사이클 노드(cyclic)는 order에 없으므로 자동 제외.
 */
export function readyNodes(graph: TaskGraph, opts: ReadinessOptions = {}): string[] {
  return topoSort(graph).order.filter((id) => {
    const wp = graph.nodes.get(id)
    return wp !== undefined && isReady(wp, graph, opts)
  })
}
