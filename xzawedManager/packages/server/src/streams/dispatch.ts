import { buildTaskGraph, readyNodes, topoSort, oracleSatisfiedSet } from '@xzawed/agent-streams'
import type { TaskGraph, ReadinessOptions, ApprovedOracleView, WorkPackage, OperationalMode } from '@xzawed/agent-streams'
import type { TaskGraphRepo } from '../db/task-graph.repo.js'
import type { DispatchStore } from '../db/dispatch.repo.js'
import { DRAFTED_STATE, DISPATCHED_STATE, ESCALATED_STATE, DONE_STATE, DEFAULT_VISIBILITY_MS } from './dispatch-constants.js'
import { publishDispatchSignal } from './dispatch-signal.js'
import type { Publish } from './decomposition-consumer.js'

export interface DispatchPlanItem {
  wpId: string
  /** topoSort.order 인덱스(결정론). 이벤트 payload·lease.step_n 표시·정렬용(N4); 멱등키 stepId는 wp-${wpId}로 분리(§8 #1). */
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

export interface OracleStore {
  approvedByWorkflow(workflowId: string): Promise<ApprovedOracleView[]>
}
export interface DispatchDeps {
  repo: TaskGraphRepo
  store: DispatchStore
  /** DoR done/oracle 판정 주입 — planDispatch로 전달(P3 Oracle·완료 done-set seam). */
  readiness?: ReadinessOptions
  /** P3-1: 주입 시 디스패치마다 approved 오라클로 satisfied-set 산출→oracleSatisfied 주입(기본 술어 대체). */
  oracleStore?: OracleStore
  /** lease 가시성 타임아웃(ms). 기본 DEFAULT_VISIBILITY_MS. */
  visibilityMs?: number
  /** P4-1: 주입 시 recordDispatch 후 wp.dispatch_signal 발행(워커 트리거). 미주입이면 무발행(회귀 0). */
  publish?: Publish
  now?: () => number
  /** P5-3b: 운영 강등 모드 조회(주입 시). SAFE면 handleDispatch가 신규 디스패치를 보류(held)·recordDispatch 미실행. */
  getMode?: () => OperationalMode
  /** P5-3b: SAFE 보류 시 콜백(held-set 적재용). Supervisor.resumeDispatch가 드레인해 재디스패치. */
  onHeld?: (workflowId: string) => void
}

export interface DispatchOutcome {
  /** 'noop'=그래프 없음(평가 안 함), 'dispatched'=평가함(비어 있을 수 있음), 'held'=SAFE 모드 보류(P5-3b). */
  status: 'dispatched' | 'noop' | 'held'
  dispatched: Array<{ wpId: string; stepN: number; eventId: string }>
  /** ready였으나 이미 디스패치돼 제외된 노드 수. */
  skipped: number
}

/**
 * DoR readiness를 조립한다(P1d-6 done-set 파생 + P3-1 oracle satisfied-set 주입).
 * isDone은 latestStates의 DONE을 항상 포함하고 주입 isDone과 **합성**(완료-unblock 보존).
 * oracleStore 주입 시 approved 오라클로 satisfied-set을 산출해 oracleSatisfied를 주입(기본 술어 대체);
 * 미주입이면 정적 readiness.oracleSatisfied(테스트)만 전달 — flag off 회귀 0.
 */
async function buildReadiness(
  workflowId: string,
  deps: DispatchDeps,
  workPackages: WorkPackage[],
  doneSet: ReadonlySet<string>,
): Promise<ReadinessOptions> {
  const injectedDone = deps.readiness?.isDone
  const readiness: ReadinessOptions = {
    isDone: injectedDone ? (wp) => doneSet.has(wp.id) || injectedDone(wp) : (wp) => doneSet.has(wp.id),
  }
  if (deps.oracleStore) {
    const approved = await deps.oracleStore.approvedByWorkflow(workflowId)
    const satisfied = oracleSatisfiedSet(workPackages, approved)
    readiness.oracleSatisfied = (wp) => satisfied.has(wp.id)
  } else if (deps.readiness?.oracleSatisfied) {
    readiness.oracleSatisfied = deps.readiness.oracleSatisfied
  }
  return readiness
}

/**
 * 영속 그래프를 디스패치한다: getGraph → latestStates로 alreadyDispatched 파생 → planDispatch →
 * 항목별 원자 recordDispatch(M5). handleDecompositionEmitted 대칭(읽기·계획·원자 적재 분리).
 */
export async function handleDispatch(workflowId: string, deps: DispatchDeps): Promise<DispatchOutcome> {
  const stored = await deps.repo.getGraph(workflowId)
  if (!stored) return { status: 'noop', dispatched: [], skipped: 0 }

  // P5-3b: SAFE 모드면 신규 디스패치 보류(held). held WP는 상태 전이 0(DRAFTED 유지) → SAFE 이탈 시
  // Supervisor.resumeDispatch가 onHeld로 기록된 워크플로를 재디스패치. getMode 미주입(enforce off)→스킵(회귀 0).
  if (deps.getMode?.() === 'SAFE') {
    deps.onHeld?.(workflowId)
    return { status: 'held', dispatched: [], skipped: 0 }
  }

  // 사이클/구조오류는 P1d-2가 영속 전 차단하므로 getGraph는 정상 그래프만 보유(불변식).
  const graph = buildTaskGraph(stored.workPackages)
  const states = await deps.repo.latestStates(workflowId)
  const alreadyDispatched = new Set<string>() // DISPATCHED ∪ ESCALATED — 재디스패치 금지
  const doneSet = new Set<string>()           // DONE — DoR done(완료가 후행 unblock, P1d-6)
  for (const [wpId, rec] of states) {
    if (rec.toState === DISPATCHED_STATE || rec.toState === ESCALATED_STATE) alreadyDispatched.add(wpId)
    if (rec.toState === DONE_STATE) doneSet.add(wpId)
  }
  // DoR done/oracle 판정을 헬퍼로 조립(P1d-6 done-set 합성 + P3-1 oracle satisfied-set).
  const readiness = await buildReadiness(workflowId, deps, stored.workPackages, doneSet)

  // skipped = ready ∩ alreadyDispatched. ready와 planDispatch 내부 readyNodes는 같은
  // graph·readiness에 대한 순수·결정론 호출(N4 불변식)이라 결과가 일치 → 차집합 크기로 정확.
  const ready = readyNodes(graph, readiness)
  const plan = planDispatch(graph, { alreadyDispatched, readiness })
  const skipped = ready.length - plan.length

  const visibilityMs = deps.visibilityMs ?? DEFAULT_VISIBILITY_MS
  const dispatched: DispatchOutcome['dispatched'] = []
  let deduped = 0
  for (const item of plan) {
    const r = await deps.store.recordDispatch({
      workflowId,
      wpId: item.wpId,
      stepN: item.stepN,
      fromState: item.fromState,
      attempt: 0,
      visibilityMs,
      causationId: stored.eventId ?? null,
    })
    // deduped = lease가 이미 존재(동시/재진입). dispatched에서 제외하고 skipped로 집계(§8 #2).
    if (r.status === 'recorded') {
      dispatched.push({ wpId: item.wpId, stepN: item.stepN, eventId: r.eventId })
      if (deps.publish) await publishDispatchSignal(deps.publish, workflowId, item.wpId, 0, deps.now?.())
    } else deduped += 1
  }
  return { status: 'dispatched', dispatched, skipped: skipped + deduped }
}
