import { z } from 'zod'
import { makeEnvelope } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { UserContext } from '../types/user-context.js'
import { defaultInconsistentStream, type Publish } from './decomposition-consumer.js'
import type { AgentExecutor } from './worker.js'
import {
  buildConformanceAuthorPlan, buildGoldenDiffAuthorPlan, selectAuthoredTestFiles,
  CONFORMANCE_DIR, IMPACT_DIR, type ConformanceOracleStore, type ImpactOracleStore,
} from './conformance.js'

export const WP_VERIFICATION_FAILED = 'wp.verification.failed'
/** 관측 이벤트 reason 상한 — 에이전트 오류 메시지 폭주가 페이로드를 키우지 않도록. */
const REASON_MAX = 500

export type VerificationVerdict = { ok: true } | { ok: false; reason: string }

/** 판정 전용 minimal 스키마 — 핸들러 outputSchema의 .default()에 기대지 않고
 *  필드 부재=파싱 실패=fail(불확실=실패, senario N1). `passed`는 N8 vacuous-pass 봉합용. */
const TesterResultSchema = z.object({ success: z.boolean(), passed: z.number(), failed: z.number() })
const BuilderResultSchema = z.object({ success: z.boolean() })

/**
 * 결과-근거 판정: 도구의 실 실행 결과(구조화 필드)만으로 통과를 판정한다(LLM 선언 불가·N1).
 * run_tests/build_project 외 도구는 결과-근거 채널 비적용(파생 체크 또는 후속 4d가 담당) → ok.
 */
export function judgePrimaryResult(tool: string, result: unknown): VerificationVerdict {
  if (tool === 'run_tests') {
    const parsed = TesterResultSchema.safeParse(result)
    if (!parsed.success) return { ok: false, reason: 'run_tests: 결과 파싱 실패(success/passed/failed 부재)' }
    if (!parsed.data.success || parsed.data.failed > 0) {
      return { ok: false, reason: `run_tests: success=${parsed.data.success} failed=${parsed.data.failed}` }
    }
    // N8 vacuous-pass 봉합: success·failed=0이어도 실행·통과한 테스트가 0이면 빈 껍데기 스위트(0-test가
    // failed:0으로 통과하던 false-pass) — 게이트를 열지 않는다(fail-closed). 약한/빈 conformance 테스트도 차단.
    if (parsed.data.passed <= 0) {
      return { ok: false, reason: `run_tests: vacuous pass — 실행·통과 테스트 0개(passed=${parsed.data.passed})` }
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
  buildInput: (wp: WorkPackage, userContext?: UserContext) => Record<string, unknown>
  /** exactOptionalPropertyTypes: 워커가 `stored?.userContext ?? undefined`를 그대로 넘긴다. */
  userContext?: UserContext | undefined
  workflowId: string
  /** 신호의 attempt — 체크 세션 격리 키에 포함(attempt 간 좀비 응답 교차 귀속 차단). */
  attempt: number
  /** P4b-2/P4: 승인 오라클 조회 포트(conformance scenarios + impact golden_refs). OracleRepo가 둘 다 구현. */
  oracleStore?: ConformanceOracleStore & ImpactOracleStore
  /** P4b-2: conformance 채널 활성(=MANAGER_WP_CONFORMANCE && oracleStore 주입). */
  conformanceEnabled?: boolean
  /** P4: impact golden-differential 채널 활성(=MANAGER_WP_IMPACT && oracleStore 주입). */
  impactEnabled?: boolean
}

/** 검증 체크 전용 세션 키. RedisAgentHandler의 응답 매칭은 무상관(스트림 위치+type뿐)이라 워크플로 공유
 *  세션에서는 타임아웃된 이전 체크의 좀비 응답이 다음 attempt의 판정으로 오귀속될 수 있다(N1 false-pass) —
 *  (wpId, attempt)별 사설 응답 스트림으로 격리해 구조적으로 차단한다. 게이트웨이 notify는 sessionId를
 *  페이로드로 전달하므로 임의 키가 기존 메커니즘으로 동작한다. */
export const verifySessionId = (workflowId: string, wpId: string, attempt: number, suffix?: string): string => {
  const suffixPart = suffix ? `-${suffix}` : ''
  return `${workflowId}-verify-${wpId}-${attempt}${suffixPart}`
}

/** conformance 에이전트 1회 실행(입력 빌드 포함)을 never-throw로 감싸 결과 또는 fail verdict 반환.
 *  buildInput·execute 모두 try 안에서 수행해 어떤 throw도 fail-closed verdict로 변환(N1). */
async function execConformanceStep(
  deps: VerifyDeps, wp: WorkPackage, extra: Record<string, unknown>, tool: string, suffix: string,
): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> {
  const handler = deps.handlers[tool]
  if (!handler) return { ok: false, reason: `conformance: ${tool} 핸들러 미주입` }
  try {
    const input = { ...deps.buildInput(wp, deps.userContext), ...extra }
    const result = await handler.execute(input, verifySessionId(deps.workflowId, wp.id, deps.attempt, suffix), deps.userContext)
    return { ok: true, result }
  } catch (err) {
    return { ok: false, reason: `conformance: ${tool} 실행 실패 — ${err instanceof Error ? err.message : String(err)}` }
  }
}

interface AuthoredCheckConfig<T> {
  enabled: boolean
  dir: string
  authorSuffix: string
  runSuffix: string
  /** 사람 승인 베이스라인 조회. null이면 skip(ok). */
  baseline: () => Promise<T | null>
  /** 베이스라인을 author develop_code plan으로 인코딩. */
  buildPlan: (baseline: T) => string
}

/**
 * author→run 검증 골격(P4b-2 conformance·P4 impact 공유). 사람 승인 베이스라인을 독립 develop_code 호출이
 * 실행 테스트로 인코딩(격리 세션·N6)→Tester가 그 testFiles 실행→결과-근거 판정(passed>0 floor 포함). never-throw·
 * fail-closed(불확실=실패, N1). 미활성/베이스라인 부재면 skip(ok·회귀 0).
 */
async function runAuthoredCheck<T>(wp: WorkPackage, deps: VerifyDeps, cfg: AuthoredCheckConfig<T>): Promise<VerificationVerdict> {
  if (!cfg.enabled || !deps.oracleStore) return { ok: true }
  let baseline: T | null
  try {
    baseline = await cfg.baseline()
  } catch (err) {
    return { ok: false, reason: `${cfg.dir}: 베이스라인 조회 실패 — ${err instanceof Error ? err.message : String(err)}` }
  }
  if (baseline == null) return { ok: true } // 승인 베이스라인 없음 → skip(회귀 0)
  if (!deps.userContext?.workspaceRoot) {
    return { ok: false, reason: `${cfg.dir}: workspaceRoot 미영속 — 검증 대상 경로 불명(fail-closed)` }
  }
  if (!deps.handlers['develop_code'] || !deps.handlers['run_tests']) {
    return { ok: false, reason: `${cfg.dir}: develop_code/run_tests 핸들러 미주입` }
  }
  return executeAuthoredTest(wp, deps, cfg.buildPlan(baseline), cfg.dir, cfg.authorSuffix, cfg.runSuffix)
}

/** author→run→judge 실행부(runAuthoredCheck 가드 통과 후). ①독립 develop_code가 테스트 작성(격리 세션·N6)
 *  →②Tester가 그 testFiles만 실행→결과-근거 판정. 인지복잡도 분리용 추출(동작 불변). */
async function executeAuthoredTest(
  wp: WorkPackage, deps: VerifyDeps, plan: string, dir: string, authorSuffix: string, runSuffix: string,
): Promise<VerificationVerdict> {
  const authored = await execConformanceStep(deps, wp, { plan }, 'develop_code', authorSuffix)
  if (!authored.ok) return authored
  const authorResult = authored.result as { artifacts?: unknown } | null | undefined
  const rawArtifacts = authorResult?.artifacts
  const artifacts = Array.isArray(rawArtifacts) ? rawArtifacts.filter((a): a is string => typeof a === 'string') : []
  const testFiles = selectAuthoredTestFiles(artifacts, dir, wp.id)
  if (testFiles.length === 0) return { ok: false, reason: `${dir}: author가 테스트 파일 미생성(fail-closed)` }
  const ran = await execConformanceStep(deps, wp, { testFiles }, 'run_tests', runSuffix)
  if (!ran.ok) return ran
  return judgePrimaryResult('run_tests', ran.result)
}

/** P4b-2 conformance 채널: 사람 승인 GWT 시나리오를 실행 테스트로 소비(N1·N6). 미주입/미활성/오라클 부재면 skip. */
function runConformanceCheck(wp: WorkPackage, deps: VerifyDeps): Promise<VerificationVerdict> {
  return runAuthoredCheck(wp, deps, {
    enabled: deps.conformanceEnabled === true,
    dir: CONFORMANCE_DIR, authorSuffix: 'conf-author', runSuffix: 'conf-run',
    baseline: async () => (await deps.oracleStore?.approvedOracleForStory(deps.workflowId, wp.storyId)) ?? null,
    buildPlan: (oracle) => buildConformanceAuthorPlan(wp, oracle.scenarios),
  })
}

/** P4 impact 채널: 사람 사인오프 golden을 differential 실행 테스트로 소비(golden 읽기만·N7·N8). drift면 fail(blocking). */
function runImpactCheck(wp: WorkPackage, deps: VerifyDeps): Promise<VerificationVerdict> {
  return runAuthoredCheck(wp, deps, {
    enabled: deps.impactEnabled === true,
    dir: IMPACT_DIR, authorSuffix: 'impact-author', runSuffix: 'impact-run',
    baseline: async () => (await deps.oracleStore?.approvedGoldensForStory(deps.workflowId, wp.storyId)) ?? null,
    buildPlan: (goldens) => buildGoldenDiffAuthorPlan(wp, goldens),
  })
}

/**
 * WP 검증(P4b-1 correctness 채널 골격): ①결과-근거 판정 ②파생 체크 실 재실행(fail-fast).
 * never-throw — 모든 불확실(핸들러 부재·throw·파싱 실패·검증 대상 경로 불명)은 fail verdict(fail-closed, N1).
 * 검증 통과는 LLM 선언이 아니라 tester/builder의 실 spawn 실행 결과 필드로만 성립한다.
 */
export async function verifyWp(
  tool: string, wp: WorkPackage, result: unknown, deps: VerifyDeps,
): Promise<VerificationVerdict> {
  const primary = judgePrimaryResult(tool, result)
  if (!primary.ok) return primary
  const checks = planVerificationChecks(tool)
  if (checks.length === 0) return { ok: true }
  // 파생 체크는 검증 대상 워크스페이스 경로가 명시돼야만 의미가 있다 — 부재 시 '.'로 돌리면 에이전트
  // cwd⊂WORKSPACE_ROOT 배포에서 엉뚱한 프로젝트(에이전트 자신)를 빌드·테스트해 false PASS가 된다.
  if (!deps.userContext?.workspaceRoot) {
    return { ok: false, reason: 'workspaceRoot 미영속 — 검증 대상 경로 불명(fail-closed)' }
  }
  const checkSession = verifySessionId(deps.workflowId, wp.id, deps.attempt)
  for (const check of checks) {
    const handler = deps.handlers[check]
    if (!handler) return { ok: false, reason: `${check}: 체크 핸들러 미주입` }
    let checkResult: unknown
    try {
      checkResult = await handler.execute(deps.buildInput(wp, deps.userContext), checkSession, deps.userContext)
    } catch (err) {
      return { ok: false, reason: `${check}: 체크 실행 실패 — ${err instanceof Error ? err.message : String(err)}` }
    }
    const verdict = judgePrimaryResult(check, checkResult)
    if (!verdict.ok) return verdict
  }
  if (tool === 'develop_code') {
    const conf = await runConformanceCheck(wp, deps)
    if (!conf.ok) return conf
    return runImpactCheck(wp, deps) // P4 impact golden-differential hard-AND(conformance 통과 후)
  }
  return { ok: true }
}

/** 검증 실패 관측 이벤트(소비자 배선 전까지 사람 도달 신호는 lease 상태머신의 ESCALATED — 이 이벤트는 추적용).
 *  best-effort — 발행 실패해도 완료 부재가 load-bearing 신호(lease 백스톱이 reclaim→escalate 보장).
 *  스트림은 decomposition.inconsistent와 단일 출처 공유(contract-drift 회피). */
export async function publishVerificationFailed(
  publish: Publish, workflowId: string, wpId: string, attempt: number, reason: string, now?: number,
): Promise<void> {
  const envelope = makeEnvelope(
    { correlationId: workflowId, causationId: null, workflowId, stepId: `${WP_VERIFICATION_FAILED}:${wpId}`, attemptId: attempt },
    now ?? Date.now(),
  )
  await publish(defaultInconsistentStream(workflowId), {
    envelope, type: WP_VERIFICATION_FAILED, payload: { wpId, attempt, reason: reason.slice(0, REASON_MAX) },
  })
}
