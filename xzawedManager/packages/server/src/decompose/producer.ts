import { makeEnvelope } from '@xzawed/agent-streams'
import type { ClaudeLike, WorkPackage } from '@xzawed/agent-streams'
import { runDecomposition, fallbackWorkPackages, DEFAULT_REPAIR_MAX, type DecomposeResult } from './pipeline.js'
import { defaultInconsistentStream, type InconsistentReason } from '../streams/decomposition-consumer.js'

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
}

export interface ProduceResult {
  emitted: number
  escalated: boolean
}

/** decomposition.emitted 발행(ok·fallback 공용). */
async function emitWorkPackages(deps: ProduceDeps, workflowId: string, workPackages: WorkPackage[]): Promise<void> {
  const envelope = makeEnvelope(
    { correlationId: workflowId, causationId: null, workflowId, stepId: 'decomposition.emitted', attemptId: 0 },
    deps.now?.(),
  )
  await deps.publish(DECOMPOSE_STREAM, { envelope, type: 'decomposition.emitted', payload: { workPackages } })
}

/**
 * intent → 다단계 분해+자가수선(runDecomposition) → status 분기.
 * ok → decomposition.emitted(payload {workPackages} 불변). inconsistent → decomposition.inconsistent
 * (reason 'coverage') 발행·WP 미발행. 기술 throw → fallback 단일 WP emit. coverage·린트는 로그 전용.
 */
export async function produceDecomposition(
  intent: string,
  workflowId: string,
  deps: ProduceDeps,
): Promise<ProduceResult> {
  let result: DecomposeResult
  try {
    result = await runDecomposition(
      intent,
      { claude: deps.claude, model: deps.model, timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      deps.repairMax ?? DEFAULT_REPAIR_MAX,
    )
  } catch (err) {
    deps.log?.('[decompose] runDecomposition threw unexpectedly — falling back', {
      error: err instanceof Error ? err.message : String(err),
    })
    const workPackages = fallbackWorkPackages(intent)
    await emitWorkPackages(deps, workflowId, workPackages)
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
  await emitWorkPackages(deps, workflowId, result.workPackages)
  return { emitted: result.workPackages.length, escalated: false }
}
