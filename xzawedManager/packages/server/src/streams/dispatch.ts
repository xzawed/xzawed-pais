import { buildTaskGraph, readyNodes, topoSort } from '@xzawed/agent-streams'
import type { TaskGraph, ReadinessOptions } from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { DispatchStore } from '../db/dispatch.repo.js'
import { DRAFTED_STATE, DISPATCHED_STATE } from './dispatch-constants.js'

export interface DispatchPlanItem {
  wpId: string
  /** topoSort.order 인덱스(결정론). 봉투 stepId='step-${stepN}'. */
  stepN: number
  /** 전이 from_state(초기 디스패치=DRAFTED). */
  fromState: string
}

export interface PlanDispatchOptions {
  /** 이미 디스패치된(또는 그 이후) wp_id — 재디스패치 제외(호출자가 latestStates에서 파생). */
  alreadyDispatched?: ReadonlySet<string>
  /** DoR done/oracle 판정 주입(코어 readyNodes로 전달). */
  readiness?: ReadinessOptions
}

/**
 * 디스패치 계획(순수): readyNodes(DoR) ∩ !alreadyDispatched, topoSort.order 인덱스로 step-N 부여.
 * I/O·부수효과 0. 결과는 결정론 순서(readyNodes가 topo 순서). 상태명 비의존(DRAFTED from만 사용).
 */
export function planDispatch(graph: TaskGraph, opts: PlanDispatchOptions = {}): DispatchPlanItem[] {
  const already = opts.alreadyDispatched ?? new Set<string>()
  const order = topoSort(graph).order
  return readyNodes(graph, opts.readiness)
    .filter((id) => !already.has(id))
    .map((id) => ({ wpId: id, stepN: order.indexOf(id), fromState: DRAFTED_STATE }))
}

export interface DispatchDeps {
  repo: TaskGraphRepo
  store: DispatchStore
  /** DoR done/oracle 판정 주입 — planDispatch로 전달(P3 Oracle·완료 done-set seam). */
  readiness?: ReadinessOptions
}

export interface DispatchOutcome {
  /** 'noop'=그래프 없음(평가 안 함), 'dispatched'=평가함(dispatched는 비어 있을 수 있음). */
  status: 'dispatched' | 'noop'
  dispatched: Array<{ wpId: string; stepN: number; eventId: string }>
  /** ready였으나 이미 디스패치돼 제외된 노드 수. */
  skipped: number
}

/**
 * 영속 그래프를 디스패치한다: getGraph → latestStates로 alreadyDispatched 파생 → planDispatch →
 * 항목별 원자 recordDispatch(M5). handleDecompositionEmitted 대칭(읽기·계획·원자 적재 분리).
 */
export async function handleDispatch(workflowId: string, deps: DispatchDeps): Promise<DispatchOutcome> {
  const stored = await deps.repo.getGraph(workflowId)
  if (!stored) return { status: 'noop', dispatched: [], skipped: 0 }

  // 사이클/구조오류는 P1d-2가 영속 전 차단하므로 getGraph는 정상 그래프만 보유(불변식).
  const graph = buildTaskGraph(stored.workPackages)
  const states = await deps.repo.latestStates(workflowId)
  const alreadyDispatched = new Set<string>()
  for (const [wpId, rec] of states) {
    if (rec.toState === DISPATCHED_STATE) alreadyDispatched.add(wpId)
  }

  // skipped = ready ∩ alreadyDispatched. ready와 planDispatch 내부 readyNodes는 같은
  // graph·readiness에 대한 순수·결정론 호출(N4 불변식)이라 결과가 일치 → 차집합 크기로 정확.
  const ready = readyNodes(graph, deps.readiness)
  const planOpts: PlanDispatchOptions = deps.readiness
    ? { alreadyDispatched, readiness: deps.readiness }
    : { alreadyDispatched }
  const plan = planDispatch(graph, planOpts)
  const skipped = ready.length - plan.length

  const dispatched: DispatchOutcome['dispatched'] = []
  for (const item of plan) {
    const { eventId } = await deps.store.recordDispatch({
      workflowId,
      wpId: item.wpId,
      stepN: item.stepN,
      fromState: item.fromState,
      causationId: stored.eventId ?? null,
    })
    dispatched.push({ wpId: item.wpId, stepN: item.stepN, eventId })
  }
  return { status: 'dispatched', dispatched, skipped }
}
