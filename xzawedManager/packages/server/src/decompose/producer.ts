import { makeEnvelope } from '@xzawed/agent-streams'
import type { ClaudeLike, WorkPackage, BudgetCircuitBreaker, ProviderCircuitBreaker } from '@xzawed/agent-streams'
import { runDecomposition, fallbackWorkPackages, DEFAULT_REPAIR_MAX, type DecomposeResult } from './pipeline.js'
import { defaultInconsistentStream, type InconsistentReason } from '../streams/decomposition-consumer.js'
import { buildStageCircuit } from './stages/run-stage.js'
import type { OracleDraft } from '../db/oracle.types.js'
import type { UserContext } from '../types/user-context.js'

/** Supervisor DecompositionConsumer가 구독하는 스트림(manager:decomposition:{channel='main'}). */
export const DECOMPOSE_STREAM = 'manager:decomposition:main'
const DEFAULT_TIMEOUT_MS = 120_000

export type DecomposePublish = (stream: string, message: Record<string, unknown>) => Promise<unknown>

export interface ProduceDeps {
  claude: ClaudeLike
  model: string
  publish: DecomposePublish
  /** 단계 LLM 호출 타임아웃(ms). 미지정 시 기본값. server.ts가 config.CLAUDE_TIMEOUT_MS 주입. */
  timeoutMs?: number
  /** P4 repair 최대 반복. 미지정 시 DEFAULT_REPAIR_MAX. server.ts가 config 주입. */
  repairMax?: number
  now?: () => number
  /** 관측용 로거(coverage·에스컬레이션 보고). 미지정 시 무음. */
  log?: (msg: string, data?: Record<string, unknown>) => void
  /** P7 초안 생성(MANAGER_ORACLE_DRAFT). server.ts 주입. */
  draftOracles?: boolean
  /** F5: invariant 초안 생성(MANAGER_ORACLE_INVARIANTS). server.ts 주입. 전제 draftOracles. */
  draftInvariants?: boolean
  /** G1: §13 budget/provider 서킷(러너·risk와 동일 인스턴스). 미주입이면 무보호(회귀 0). */
  budget?: BudgetCircuitBreaker
  provider?: ProviderCircuitBreaker
  isProviderFailure?: (err: unknown) => boolean
}

export interface ProduceResult {
  emitted: number
  escalated: boolean
}

/** decomposition.emitted 발행(ok·fallback 공용). oracleDrafts는 ok 경로만 채움(기본 []·additive).
 *  userContext(P4a-2)는 존재 시에만 payload에 포함 — 그래프 영속→실행 워커 주입 경로. */
async function emitWorkPackages(
  deps: ProduceDeps,
  workflowId: string,
  workPackages: WorkPackage[],
  oracleDrafts: OracleDraft[] = [],
  userContext?: UserContext,
): Promise<void> {
  const envelope = makeEnvelope(
    { correlationId: workflowId, causationId: null, workflowId, stepId: 'decomposition.emitted', attemptId: 0 },
    deps.now?.(),
  )
  await deps.publish(DECOMPOSE_STREAM, {
    envelope,
    type: 'decomposition.emitted',
    payload: { workPackages, oracleDrafts, ...(userContext !== undefined && { userContext }) },
  })
}

/**
 * intent → 다단계 분해+자가수선(runDecomposition) → status 분기.
 * ok → decomposition.emitted(payload {workPackages, oracleDrafts}; oracleDrafts는 draft flag 시만 채움).
 * inconsistent → decomposition.inconsistent(reason 'coverage') 발행·WP 미발행. 기술 throw → fallback 단일 WP
 * emit(oracleDrafts []). coverage·린트는 로그 전용.
 */
export async function produceDecomposition(
  intent: string,
  workflowId: string,
  deps: ProduceDeps,
  userContext?: UserContext,
): Promise<ProduceResult> {
  const circuit = buildStageCircuit(workflowId, {
    ...(deps.budget && { budget: deps.budget }),
    ...(deps.provider && { provider: deps.provider }),
    ...(deps.isProviderFailure && { isProviderFailure: deps.isProviderFailure }),
  })
  let result: DecomposeResult
  try {
    result = await runDecomposition(
      intent,
      { claude: deps.claude, model: deps.model, timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(circuit && { circuit }) },
      deps.repairMax ?? DEFAULT_REPAIR_MAX,
      deps.draftOracles ?? false,
      deps.draftInvariants ?? false,
    )
  } catch (err) {
    deps.log?.('[decompose] runDecomposition threw unexpectedly — falling back', {
      error: err instanceof Error ? err.message : String(err),
    })
    const workPackages = fallbackWorkPackages(intent)
    await emitWorkPackages(deps, workflowId, workPackages, [], userContext)
    return { emitted: workPackages.length, escalated: false }
  }

  if (result.status === 'inconsistent') {
    deps.log?.('[decompose] coverage unresolved — escalating', {
      gaps: result.coverage.gaps.length,
      overlaps: result.coverage.overlaps.length,
      unknownClaims: result.coverage.unknownClaims.length,
    })
    const envelope = makeEnvelope(
      { correlationId: workflowId, causationId: null, workflowId, stepId: 'decomposition.inconsistent', attemptId: 0 },
      deps.now?.(),
    )
    const reason: InconsistentReason = result.reason
    // payload는 §6 루프 조건(gaps/overlaps)만 — unknownClaims는 발행 그래프에 무해해 제외(로그로만 관측).
    await deps.publish(defaultInconsistentStream(workflowId), {
      envelope,
      type: 'decomposition.inconsistent',
      payload: { reason, gaps: result.coverage.gaps, overlaps: result.coverage.overlaps },
    })
    return { emitted: 0, escalated: true }
  }

  deps.log?.('[decompose] coverage', {
    gaps: result.coverage.gaps.length,
    overlaps: result.coverage.overlaps.length,
    unknownClaims: result.coverage.unknownClaims.length,
    singleRoleStoryIds: result.singleRoleStoryIds.length,
  })
  // ok 경로만 oracleDrafts 전달 — inconsistent/기술 fallback 경로는 기본 [](degraded·blocker#5).
  await emitWorkPackages(deps, workflowId, result.workPackages, result.oracleDrafts, userContext)
  return { emitted: result.workPackages.length, escalated: false }
}
