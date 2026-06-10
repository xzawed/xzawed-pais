import { z } from 'zod'

export const WP_VERIFICATION_FAILED = 'wp.verification.failed'

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
