import { makeEnvelope } from '@xzawed/agent-streams'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { runDecomposition, fallbackWorkPackages } from './pipeline.js'

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
  now?: () => number
  /** 관측용 로거(coverage 보고 등). 미지정 시 무음. */
  log?: (msg: string, data?: Record<string, unknown>) => void
}

/**
 * intent → 4단계 분해(runDecomposition) → decomposition.emitted 발행. 워크플로 1건.
 * 단계들이 각자 degrade하므로 정상 경로는 throw 없음. 예외 시 fallback(단일 WP)로 흡수 — 빈 발행 없음.
 * coverage는 로그 전용(P2-3a) — emit 페이로드는 {workPackages} 불변.
 */
export async function produceDecomposition(
  intent: string,
  workflowId: string,
  deps: ProduceDeps,
): Promise<{ emitted: number }> {
  let workPackages
  try {
    const result = await runDecomposition(intent, {
      claude: deps.claude,
      model: deps.model,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    workPackages = result.workPackages
    deps.log?.('[decompose] coverage', {
      gaps: result.coverage.gaps.length,
      overlaps: result.coverage.overlaps.length,
      unknownClaims: result.coverage.unknownClaims.length,
    })
  } catch {
    workPackages = fallbackWorkPackages(intent)
  }

  const envelope = makeEnvelope(
    { correlationId: workflowId, causationId: null, workflowId, stepId: 'decomposition.emitted', attemptId: 0 },
    deps.now?.(),
  )
  await deps.publish(DECOMPOSE_STREAM, { envelope, type: 'decomposition.emitted', payload: { workPackages } })
  return { emitted: workPackages.length }
}
