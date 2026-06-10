import { z } from 'zod'
import { makeEnvelope } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { UserContext } from '../types/user-context.js'
import type { Publish } from './decomposition-consumer.js'
import type { AgentExecutor } from './worker.js'

export const WP_VERIFICATION_FAILED = 'wp.verification.failed'
/** 관측 이벤트 reason 상한 — 에이전트 오류 메시지 폭주가 페이로드를 키우지 않도록. */
const REASON_MAX = 500

export type VerificationVerdict = { ok: true } | { ok: false; reason: string }

/** 판정 전용 minimal 스키마 — 핸들러 outputSchema의 .default()에 기대지 않고
 *  필드 부재=파싱 실패=fail(불확실=실패, senario N1). */
const TesterResultSchema = z.object({ success: z.boolean(), failed: z.number() })
const BuilderResultSchema = z.object({ success: z.boolean() })

/**
 * 결과-근거 판정: 도구의 실 실행 결과(구조화 필드)만으로 통과를 판정한다(LLM 선언 불가·N1).
 * run_tests/build_project 외 도구는 결과-근거 채널 비적용(파생 체크 또는 후속 4d가 담당) → ok.
 */
export function judgePrimaryResult(tool: string, result: unknown): VerificationVerdict {
  if (tool === 'run_tests') {
    const parsed = TesterResultSchema.safeParse(result)
    if (!parsed.success) return { ok: false, reason: 'run_tests: 결과 파싱 실패(success/failed 부재)' }
    if (!parsed.data.success || parsed.data.failed > 0) {
      return { ok: false, reason: `run_tests: success=${parsed.data.success} failed=${parsed.data.failed}` }
    }
    return { ok: true }
  }
  if (tool === 'build_project') {
    const parsed = BuilderResultSchema.safeParse(result)
    if (!parsed.success) return { ok: false, reason: 'build_project: 결과 파싱 실패(success 부재)' }
    if (!parsed.data.success) return { ok: false, reason: 'build_project: success=false' }
    return { ok: true }
  }
  return { ok: true }
}

/** 파생 체크 플랜: develop_code 산출물은 같은 워크스페이스에 빌드→테스트 실 재실행으로 검증(fail-fast 순서).
 *  run_tests/build_project WP는 자기 결과가 이미 실행 ground truth(이중 실행 회피),
 *  design_ui/security_audit는 실행 가능 ground truth 부재(4d) → 빈 플랜. */
export function planVerificationChecks(tool: string): string[] {
  if (tool === 'develop_code') return ['build_project', 'run_tests']
  return []
}

export interface VerifyDeps {
  /** tool명→핸들러(워커 deps.handlers 재사용 — server.ts 5종 맵). */
  handlers: Record<string, AgentExecutor>
  /** 체크 입력 생성(워커 buildWorkerInput 재사용 — 5종 union 검증 경로). */
  buildInput: (wp: WorkPackage, userContext?: UserContext) => unknown
  userContext?: UserContext
  workflowId: string
}

/**
 * WP 검증(P4b-1 correctness 채널 골격): ①결과-근거 판정 ②파생 체크 실 재실행(fail-fast).
 * never-throw — 모든 불확실(핸들러 부재·throw·파싱 실패)은 fail verdict(fail-closed, N1).
 * 검증 통과는 LLM 선언이 아니라 tester/builder의 실 spawn 실행 결과 필드로만 성립한다.
 */
export async function verifyWp(
  tool: string, wp: WorkPackage, result: unknown, deps: VerifyDeps,
): Promise<VerificationVerdict> {
  const primary = judgePrimaryResult(tool, result)
  if (!primary.ok) return primary
  for (const check of planVerificationChecks(tool)) {
    const handler = deps.handlers[check]
    if (!handler) return { ok: false, reason: `${check}: 체크 핸들러 미주입` }
    let checkResult: unknown
    try {
      checkResult = await handler.execute(deps.buildInput(wp, deps.userContext), deps.workflowId, deps.userContext)
    } catch (err) {
      return { ok: false, reason: `${check}: 체크 실행 실패 — ${err instanceof Error ? err.message : String(err)}` }
    }
    const verdict = judgePrimaryResult(check, checkResult)
    if (!verdict.ok) return verdict
  }
  return { ok: true }
}

/** 검증 실패 관측 이벤트(M8 무음 금지). best-effort — 발행 실패해도 완료 부재가 load-bearing 신호
 *  (lease 백스톱이 reclaim→escalate 보장). 스트림은 decomposition.inconsistent와 동일 패턴. */
export async function publishVerificationFailed(
  publish: Publish, workflowId: string, wpId: string, attempt: number, reason: string, now?: number,
): Promise<void> {
  const envelope = makeEnvelope(
    { correlationId: workflowId, causationId: null, workflowId, stepId: `${WP_VERIFICATION_FAILED}:${wpId}`, attemptId: attempt },
    now ?? Date.now(),
  )
  await publish(`manager:events:${workflowId}`, {
    envelope, type: WP_VERIFICATION_FAILED, payload: { wpId, attempt, reason: reason.slice(0, REASON_MAX) },
  })
}
