import { isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { makeEnvelope } from '@xzawed/agent-streams'
import type { WorkPackage, WpRisk } from '@xzawed/agent-streams'
import type { ChannelName, ChannelOutcomeKind } from '../db/release-gate.types.js'
import type { UserContext } from '../types/user-context.js'
import { defaultInconsistentStream, type Publish } from './decomposition-consumer.js'
import type { AgentExecutor } from './worker.js'
import {
  buildConformanceAuthorPlan, buildGoldenDiffAuthorPlan, buildInvariantAuthorPlan, buildMutationHarnessPlan,
  selectAuthoredTestFiles,
  CONFORMANCE_DIR, IMPACT_DIR, PROPERTY_DIR, MUTATION_DIR,
  type ConformanceOracleStore, type ImpactOracleStore, type InvariantOracleStore,
} from './conformance.js'

export const WP_VERIFICATION_FAILED = 'wp.verification.failed'
/** 관측 이벤트 reason 상한 — 에이전트 오류 메시지 폭주가 페이로드를 키우지 않도록. */
/** 관측 이벤트·영속 사유의 공통 상한 — 에이전트 오류 전문이 스트림·DB 를 잠식하지 않게(S7.1 에서 export). */
export const REASON_MAX = 500

export type VerificationVerdict = { ok: true } | { ok: false; reason: string }

/** mutation 게이트 기본값(env 미설정 시). θ는 캘리브레이션 잠정값. */
const DEFAULT_MUTATION_THETA = 0.6
const DEFAULT_MUTATION_MAX_MUTANTS = 10
const RISK_RANK: Record<WpRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

/** 결정론 SAST 소스(게이트 차단 대상). LLM findings는 제외(N6). */
const SECURITY_SOURCES = new Set<string>(['static', 'deps'])
const SECURITY_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number]
const SEVERITY_RANK: Record<SecuritySeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 }
const DEFAULT_SECURITY_MIN_SEVERITY: SecuritySeverity = 'high'

/** security 채널 판정 전용 minimal 스키마 — severity·source required(부재=파싱 실패=fail-closed·N1).
 *  `auditable`은 **`judgeAuditable`이 판정에 쓴다**(S5.1 — 미감사는 통과가 아니다).
 *  여기 없으면 상위 스키마를 통과한 필드가 이 2단 strip에서 다시 사라진다. */
const SecurityResultSchema = z.object({
  issues: z.array(z.object({
    severity: z.enum(SECURITY_SEVERITIES),
    source: z.enum(['static', 'deps', 'llm']),
  })),
  auditable: z.object({
    static: z.object({
      requested: z.number().optional(),
      scanned: z.number().optional(),
    }).optional(),
    deps: z.object({
      status: z.enum(['ok', 'unavailable', 'not_applicable']).optional(),
    }).optional(),
  }).optional(),
})

/** sev가 floor 등급 이상인지(LOW<MEDIUM<HIGH<CRITICAL). security 게이팅용. */
export function meetsMinSeverity(sev: SecuritySeverity, floor: SecuritySeverity): boolean {
  return SEVERITY_RANK[sev] >= SEVERITY_RANK[floor]
}

/** `judgeAuditable` 입력 — `SecurityResultSchema.auditable` 과 같은 모양(파싱 결과를 그대로 넘긴다). */
export type AuditableView = z.infer<typeof SecurityResultSchema>['auditable']
export type AuditableVerdict = { auditable: true } | { auditable: false; reason: string }

/**
 * **감사 불능 판정**(S5.1) — "취약점 없음"과 "스캔 못 함"을 구분한다.
 *
 * Security 가 아무것도 스캔하지 못해도 결과는 `issues: []` 로 온다. 그것만 읽으면
 * **무실행이 통과로 영속된다**(D2). `auditable` 비트는 #580 이 넣었고 생산자
 * (`xzawedSecurity/src/security.ts`)가 실제로 채우는데, 소비 쪽이 파싱만 하고 있었다.
 *
 * **fail-closed 다.** `auditable` 은 optional 이므로 `a?.static?.scanned === 0` 같은 형태로 읽으면
 * **부재가 통과**가 된다 — 막으려던 무음 통과와 정확히 같은 모양이다. 그래서 증명이 없으면 불능이다.
 *
 * 범위 밖으로 둔 하나. **부분 스캔**(`scanned < requested`)은 증거가 0 은 아니라 통과시킨다
 * — 설계상 건너뛰는 비코드 파일이 있어 여기서 막으면 오탐이 된다.
 *
 * **요청 0건은 보낸 것이 0건일 때만 정상이다.** 보낸 게 있는데 요청이 0이면 Security 가 대상을
 * 못 받은 것이라 "감사 대상 없음"과 다르다. 산출물 자체가 없는 WP 의 공허 통과는 `S5.2a` 범위다.
 */
export function judgeAuditable(
  auditable: AuditableView,
  opts: { droppedArtifacts: number; sentArtifacts: number },
): AuditableVerdict {
  // 정규화 후에도 감사할 수 없는 경로(workspaceRoot 밖·traversal)가 남으면 집계가 실제와 어긋난다.
  if (opts.droppedArtifacts > 0) {
    return { auditable: false, reason: `artifact ${opts.droppedArtifacts}건이 감사 대상 밖이라 집계를 신뢰할 수 없음` }
  }
  if (!auditable) return { auditable: false, reason: 'auditable 집계 부재 — 스캔 여부를 증명할 수 없음' }

  const s = auditable.static
  if (!s || s.requested === undefined || s.scanned === undefined) {
    return { auditable: false, reason: 'static 감사 집계 불완전(requested/scanned 부재)' }
  }
  // 수치 위생 — 음수 requested 는 아래 0-스캔 검사를 우회하고, scanned>requested 는 집계 자체가 깨진 것이다.
  // 전선은 JSON 이라 Zod `z.number()` 만으로는 정수·비음수가 보장되지 않는다.
  if (!Number.isInteger(s.requested) || !Number.isInteger(s.scanned) || s.requested < 0 || s.scanned < 0) {
    return { auditable: false, reason: `static 감사 집계가 비정상(requested=${s.requested} scanned=${s.scanned})` }
  }
  if (s.scanned > s.requested) {
    return { auditable: false, reason: `static 감사 집계 모순 — 요청 ${s.requested}건보다 스캔 ${s.scanned}건이 많음` }
  }
  // 보냈는데 요청이 0이면 Security 가 대상을 못 받았다는 뜻이다 — "대상이 원래 없었다"와 다르다.
  if (opts.sentArtifacts > 0 && s.requested === 0) {
    return { auditable: false, reason: `artifact ${opts.sentArtifacts}건을 보냈는데 감사 요청은 0건(집계 불일치)` }
  }
  if (s.requested > 0 && s.scanned === 0) {
    return { auditable: false, reason: `static 감사 무실행 — ${s.requested}건 요청 중 0건 스캔` }
  }

  const d = auditable.deps
  if (!d || d.status === undefined) return { auditable: false, reason: '의존성 감사 집계 부재' }
  if (d.status === 'unavailable') return { auditable: false, reason: '의존성 감사 불가(도구 사용 불가)' }

  return { auditable: true }
}

/**
 * artifact 경로를 **감사 가능한 형태로 정규화**한다. 감사할 수 없으면 null.
 *
 * Security 의 인바운드 스키마는 상대경로만 받는데(전선 규칙) Developer 는 절대경로를 낼 수 있다
 * (`applyChange` 가 workspaceRoot 하위 절대경로를 허용한다). 그것을 **드롭하면** 정상 산출물이
 * 감사에서 빠지고, S5.1 이 그 드롭을 불능으로 세면 **채널이 영구 차단**된다 — 전선 규칙을 판정에
 * 결합시킨 꼴이다. workspaceRoot 안이면 상대화해서 **감사 범위를 넓히는** 것이 맞다.
 *
 * 진짜로 못 하는 것만 null 이다: workspaceRoot 밖 절대경로 · traversal · 루트 자신.
 */
export function toAuditPath(artifact: string, workspaceRoot: string): string | null {
  const abs = isAbsolute(artifact) ? artifact : join(workspaceRoot, artifact)
  const rel = relative(workspaceRoot, abs)
  // 빈 문자열=루트 자신, `..` 시작=밖. 두 경우 모두 감사 대상이 아니다.
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return null
  if (isAbsolute(rel)) return null // 다른 드라이브(Windows)
  return rel.split(sep).join('/')
}

/**
 * artifact 경로를 **전선에 실을 수 있는 형태**로 정규화한다(S6.3).
 *
 * `toAuditPath` 와 같은 규칙을 WP 산출물 포착에 적용한다. Security 의 인바운드 스키마는
 * `!isAbsolute && !includes('..')` 를 강제하는데(`xzawedSecurity/src/types.ts`) **Developer 는
 * workspaceRoot 하위 절대경로를 낼 수 있다**(`applyChange` 가 허용한다 — S5.1 이 기록한 사실).
 * 정규화 없이 후행 입력으로 흘리면 safeParse 가 실패해 DLQ→120초 타임아웃이 된다.
 *
 * `workspaceRoot` 를 모르면 상대화할 수 없으므로 **이미 안전한 것만 남긴다**(fail-safe).
 * 판단할 근거가 없는 것을 통과시키지 않는다.
 */
export function toWireArtifacts(artifacts: string[], workspaceRoot?: string): string[] {
  const out = new Set<string>()
  for (const a of artifacts) {
    if (typeof a !== 'string' || a.length === 0) continue
    // workspaceRoot 를 알면 상대화하고(밖·traversal 은 null), 모르면 원문 그대로 관문에 건다.
    const candidate = workspaceRoot ? toAuditPath(a, workspaceRoot) : a
    if (candidate !== null && acceptedBySecurityInbound(candidate)) out.add(candidate)
  }
  return [...out]
}

/**
 * Security 인바운드 술어의 **사본**(`xzawedSecurity/src/types.ts` — `!isAbsolute && !includes('..')`).
 *
 * 두 분기가 서로 다른 규칙을 쓰고 있었다. 상대화 경로는 `toAuditPath` 의 **의미적** 판정
 * (`path.relative` 기준 탈출 여부)만 거쳤는데, Security 의 판정은 **어휘적**이다 — 그래서
 * `patches/v1..v2.diff` 처럼 탈출이 아닌 **정상 파일명**이 통과해 나갔다. Zod `refine` 은
 * 원소별이라 그런 경로 하나가 `security_audit` **메시지 전체**를 거부시키고 DLQ→120초
 * 타임아웃이 된다 — 한 파일이 감사에서 빠지는 것보다 훨씬 나쁘다. Grok 반증이 잡았다.
 *
 * **대가를 적어 둔다.** 이름에 `..` 가 든 정상 파일은 감사 대상에서 빠진다. Security 의 술어를
 * 의미적 검사로 완화하면 해결되지만 그것은 **보안 표면의 서비스 간 계약 변경**이라 별도 판단이다.
 * 여기서는 "보낼 수 없는 것은 보내지 않는다"만 한다 — 소비자가 못 받는 값을 만들지 않는 것이
 * 생산자의 책임이다.
 */
function acceptedBySecurityInbound(p: string): boolean {
  return !isAbsolute(p) && !p.includes('..')
}

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
  if (tool === 'security_audit') return judgeSecurityAuditWp(result)
  if (tool === 'design_ui') return judgeDesignUiWp(result)
  return { ok: true }
}

/** `design_ui` WP 자기검증 전용 minimal 스키마. `designed` 가 **여기에도** 있어야 한다 —
 *  없으면 `tools/design-ui.ts` 상위 스키마를 통과한 필드가 이 2단 strip 에서 다시 사라진다(S5.1). */
const DesignerResultSchema = z.object({
  components: z.array(z.object({ name: z.string() })),
  designed: z.object({
    source: z.enum(['llm', 'fallback']),
    components: z.number(),
  }).optional(),
})

/**
 * **`design_ui` WP 자기검증**(S5.2b / 결함 F4 · 수용 기준 L2-3).
 *
 * `security_audit` 과 같은 이유로 pass-through 였고 파생 플랜도 비어 증거 0회로 즉시 통과했다.
 * 그런데 이쪽은 **판정 재료를 만드는 것부터가 슬라이스였다.**
 *
 * **컴포넌트 수는 증거가 될 수 없다.** Designer 의 파싱 실패 폴백(`claude/runner.ts`)이
 * generic 스텁 컴포넌트 **1개**를 그대로 `design_complete` 로 발행하므로 `components.length > 0`
 * 은 프로덕션에서 **항상 참**이다. 그 술어로 게이트를 열면 LLM 응답을 한 글자도 못 읽은 실행이
 * 통과한다 — 막으려던 무음 통과와 정확히 같은 모양이다. 폴백은 Designer 프로세스 로그에
 * `console.warn` 만 남길 뿐 전선에서는 성공과 구별되지 않았다.
 *
 * 그래서 **생산자가 출처를 밝히게 했다**(`DesignAudit.source`) — `auditable` 비트(S2.2)와 같은
 * 해법이고, 소비자가 유도할 수 없는 값이라 생산자만 낼 수 있다.
 *
 * **fail-closed 다.** `designed` 는 optional 이므로 `d?.source === 'fallback'` 처럼 읽으면
 * **부재가 통과**가 된다. 증명이 없으면 통과가 아니다.
 *
 * **신뢰 경계가 생산자에 있다는 것을 명시해 둔다.** 폴백 스텁을 `source: 'llm'` 으로 실어 보내면
 * 이 판정은 통과한다 — `auditable`(S5.1)이 Security 를 믿는 것과 같은 자리다. 여기서 막는 것은
 * **정직한 생산자의 실패가 성공으로 보이는 것**이지 거짓말하는 생산자가 아니다.
 *
 * 판정을 여기서 멈춘 이유. 컴포넌트의 `description`·`props` 충실도까지 요구하면 프로덕션이
 * 실제로 내는 값에 대해 거짓 실패가 나고 design WP 가 영원히 완료되지 않는다 — S5.2a 에서
 * `requested === 0` 을 실패로 세려다 뒤집힌 것과 같은 함정이다. `DesignResponseSchema` 가
 * 이미 `components.min(1)` 과 `name.min(1)` 을 강제하므로 `source: 'llm'` 은 "LLM 응답을
 * 파싱·검증해 이름 있는 컴포넌트를 얻었다"는 뜻이다.
 */
export function judgeDesignUiWp(result: unknown): VerificationVerdict {
  const parsed = DesignerResultSchema.safeParse(result)
  if (!parsed.success) return { ok: false, reason: 'design_ui: 결과 파싱 실패(components 부재)' }

  const d = parsed.data.designed
  if (!d) return { ok: false, reason: 'design_ui: designed 집계 부재 — 설계 수행을 증명할 수 없음' }
  if (d.source === 'fallback') {
    return { ok: false, reason: 'design_ui: 폴백 스텁 — LLM 응답 파싱 실패로 실제 설계 산출물이 없음' }
  }
  const actual = parsed.data.components.length
  if (actual === 0) return { ok: false, reason: 'design_ui: 컴포넌트 0개 — 설계 산출물 없음' }
  // 집계와 배열은 생산자에서 같은 리터럴로 파생된다 — 어긋나면 전선에서 유실된 것이다(fail-closed).
  if (d.components !== actual) {
    return { ok: false, reason: `design_ui: 집계 불일치 — designed.components=${d.components} 인데 배열은 ${actual}개(전선 유실)` }
  }
  return { ok: true }
}

/**
 * **`security_audit` WP 자기검증**(S5.2a / 결함 F4 · 수용 기준 L2-3).
 *
 * 이전에는 pass-through 였고 파생 플랜도 비어 있어 **증거 0회로 즉시 통과**했다.
 * 그 결과 릴리스 게이트가 그 WP 를 `unverifiable` 로 보고 워크플로를 영구 차단했다.
 *
 * **이 WP 의 산출물 자체가 감사 결과다.** 그러니 자기검증은 "감사가 실제로 돌았는가"다 —
 * 취약점을 찾은 것은 **성공한 감사**이지 실패가 아니다. 발견을 막는 것은 *코드를 낸 WP* 의
 * security 채널 몫이고, 이 WP 의 몫은 증거 있는 감사를 내는 것이다.
 *
 * **판정 기준은 요청 건수가 아니라 "무언가가 실제로 감사됐는가"다.** `buildWorkerInput` 이 모든 WP 에
 * `artifacts: []` 를 하드코딩하므로(`worker.ts` — WP 의 `inputs`/`outputs` 미배선·F7) static 은
 * `requested: 0` 이 되지만, **의존성 감사는 `projectPath` 기준이라 artifacts 와 무관하게 실제로 돈다.**
 * 요청 0건을 곧바로 실패로 세면 그 deps 증거를 버리고 security WP 가 **영원히 완료되지 않는다** —
 * 원래 결함(DONE 은 되고 게이트만 막힘)보다 나쁘다.
 *
 * `judgeAuditable` 과 답하는 질문이 다르다. 그쪽은 "이 감사 결과를 *남의 코드* 게이트 신호로 믿어도
 * 되는가"이고, 여기는 "이 WP 가 감사 작업을 실제로 했는가"다. 그래서 `deps.unavailable` 하나로
 * 불능이 되지 않는다 — static 이 실제로 스캔했다면 증거는 존재한다.
 */
export function judgeSecurityAuditWp(result: unknown): VerificationVerdict {
  const parsed = SecurityResultSchema.safeParse(result)
  if (!parsed.success) {
    return { ok: false, reason: 'security_audit: 결과 파싱 실패(issues/severity/source 부재)' }
  }
  const a = parsed.data.auditable
  if (!a) return { ok: false, reason: 'security_audit: auditable 집계 부재 — 감사 수행을 증명할 수 없음' }

  const s = a.static
  if (!s || s.requested === undefined || s.scanned === undefined) {
    return { ok: false, reason: 'security_audit: static 감사 집계 불완전(requested/scanned 부재)' }
  }
  if (!Number.isInteger(s.requested) || !Number.isInteger(s.scanned) || s.requested < 0 || s.scanned < 0) {
    return { ok: false, reason: `security_audit: 감사 집계가 비정상(requested=${s.requested} scanned=${s.scanned})` }
  }
  // 대상을 받고도 하나도 못 스캔했으면 deps 가 돌았든 말든 **맡은 일을 안 한 것**이다.
  if (s.requested > 0 && s.scanned === 0) {
    return { ok: false, reason: `security_audit: static 감사 무실행 — ${s.requested}건 요청 중 0건 스캔` }
  }
  // 증거 = static 이 실제로 스캔했거나, 의존성 감사가 실제로 돌았거나. 둘 다 아니면 아무것도 안 했다.
  const depsRan = a.deps?.status === 'ok'
  if (s.scanned === 0 && !depsRan) {
    return {
      ok: false,
      reason: `security_audit: 공허 감사 — static 0건 스캔·deps ${a.deps?.status ?? '집계 없음'}(감사된 것이 없다)`,
    }
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
  oracleStore?: ConformanceOracleStore & ImpactOracleStore & InvariantOracleStore
  /** P4b-2: conformance 채널 활성(=MANAGER_WP_CONFORMANCE && oracleStore 주입). */
  conformanceEnabled?: boolean
  /** P4: impact golden-differential 채널 활성(=MANAGER_WP_IMPACT && oracleStore 주입). */
  impactEnabled?: boolean
  /** P4 property/invariants 채널 활성(=MANAGER_WP_PROPERTY && oracleStore 주입). */
  propertyEnabled?: boolean
  /** P4 mutation θ_risk 채널 활성(=MANAGER_WP_MUTATION). oracle 미소비. */
  mutationEnabled?: boolean
  /** mutation 통과 floor(killed/total ≥ θ). 미설정 시 DEFAULT_MUTATION_THETA. */
  mutationTheta?: number
  /** mutation 최소 실행 risk 등급(이 등급 이상만 실행). 미설정 시 'HIGH'. */
  mutationMinRisk?: WpRisk
  /** mutation 하니스가 생성할 최대 mutant 수. 미설정 시 DEFAULT_MUTATION_MAX_MUTANTS. */
  mutationMaxMutants?: number
  /** P4 4d security 채널 활성(=MANAGER_WP_SECURITY). oracle 미소비. */
  securityEnabled?: boolean
  /** security 차단 최소 severity(이 등급 이상 차단). 미설정 시 'high'. */
  securityMinSeverity?: SecuritySeverity
  /** P5-1 릴리스 게이트: 채널 outcome(passed/skipped) 표면화. 미주입이면 no-op(회귀 0). */
  recordOutcome?: (channel: ChannelName, outcome: ChannelOutcomeKind) => void
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
  channel: ChannelName
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
  // 채널 자체가 꺼져 있다 — 비대상이지 미증명이 아니다(S5.3a).
  if (!cfg.enabled) { deps.recordOutcome?.(cfg.channel, 'not_applicable'); return { ok: true } }
  // 켠 채로 스토어가 없다 = 구성 오류. 프로덕션 배선(`supervisor.ts`)이 `enabled` 를 스토어 주입과
  // AND 하므로 도달하지 않지만, **배선이 바뀌어도 조용히 통과하지 않도록** 여기서 미증명으로 센다.
  if (!deps.oracleStore) { deps.recordOutcome?.(cfg.channel, 'skipped'); return { ok: true } }
  let baseline: T | null
  try {
    baseline = await cfg.baseline()
  } catch (err) {
    return { ok: false, reason: `${cfg.dir}: 베이스라인 조회 실패 — ${err instanceof Error ? err.message : String(err)}` }
  }
  // **승인 베이스라인 없음은 비대상이 아니다 — 미증명이다.**
  //
  // 운영자가 이 채널을 **켰다**. 그런데 이 story 의 승인 오라클/골든/불변식이 하나도 없어 아무것도
  // 증명하지 못했다. 이것을 비대상으로 묶으면 "증명을 요구해 놓고 증명 없이 통과"가 된다 —
  // S5.3a 초안이 실제로 그렇게 게이트를 약화시켰고 Grok 반증이 잡았다.
  //
  // `{ ok: true }` 를 유지하는 것은 별개다. 검증 단계에서 WP 를 **실패시키지는** 않는다(회귀 0 —
  // 오라클 미승인이 WP 를 죽이지는 않는다). 릴리스 게이트에서만 막는다.
  if (baseline == null) { deps.recordOutcome?.(cfg.channel, 'skipped'); return { ok: true } }
  if (!deps.userContext?.workspaceRoot) {
    return { ok: false, reason: `${cfg.dir}: workspaceRoot 미영속 — 검증 대상 경로 불명(fail-closed)` }
  }
  if (!deps.handlers['develop_code'] || !deps.handlers['run_tests']) {
    return { ok: false, reason: `${cfg.dir}: develop_code/run_tests 핸들러 미주입` }
  }
  const verdict = await executeAuthoredTest(wp, deps, cfg.buildPlan(baseline), cfg.dir, cfg.authorSuffix, cfg.runSuffix)
  if (verdict.ok) deps.recordOutcome?.(cfg.channel, 'passed')
  return verdict
}

/** 산출물 result에서 문자열 artifact 경로만 추출(executeAuthoredTest·security 채널 공유). */
export function extractArtifacts(result: unknown): string[] {
  const raw = (result as { artifacts?: unknown } | null | undefined)?.artifacts
  return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === 'string') : []
}

/** author→run→judge 실행부(runAuthoredCheck 가드 통과 후). ①독립 develop_code가 테스트 작성(격리 세션·N6)
 *  →②Tester가 그 testFiles만 실행→결과-근거 판정. 인지복잡도 분리용 추출(동작 불변). */
async function executeAuthoredTest(
  wp: WorkPackage, deps: VerifyDeps, plan: string, dir: string, authorSuffix: string, runSuffix: string,
): Promise<VerificationVerdict> {
  const authored = await execConformanceStep(deps, wp, { plan }, 'develop_code', authorSuffix)
  if (!authored.ok) return authored
  const artifacts = extractArtifacts(authored.result)
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
    channel: 'conformance',
    dir: CONFORMANCE_DIR, authorSuffix: 'conf-author', runSuffix: 'conf-run',
    baseline: async () => (await deps.oracleStore?.approvedOracleForStory(deps.workflowId, wp.storyId)) ?? null,
    buildPlan: (oracle) => buildConformanceAuthorPlan(wp, oracle.scenarios),
  })
}

/** P4 impact 채널: 사람 사인오프 golden을 differential 실행 테스트로 소비(golden 읽기만·N7·N8). drift면 fail(blocking). */
function runImpactCheck(wp: WorkPackage, deps: VerifyDeps): Promise<VerificationVerdict> {
  return runAuthoredCheck(wp, deps, {
    enabled: deps.impactEnabled === true,
    channel: 'impact',
    dir: IMPACT_DIR, authorSuffix: 'impact-author', runSuffix: 'impact-run',
    baseline: async () => (await deps.oracleStore?.approvedGoldensForStory(deps.workflowId, wp.storyId)) ?? null,
    buildPlan: (goldens) => buildGoldenDiffAuthorPlan(wp, goldens),
  })
}

/** P4 property 채널(conformance 렌즈): 사람 승인 invariants를 boundary+명시 속성 단언 테스트로 소비(N1·N6·invariants 읽기전용). 위반이면 fail(blocking). */
function runPropertyCheck(wp: WorkPackage, deps: VerifyDeps): Promise<VerificationVerdict> {
  return runAuthoredCheck(wp, deps, {
    enabled: deps.propertyEnabled === true,
    channel: 'property',
    dir: PROPERTY_DIR, authorSuffix: 'prop-author', runSuffix: 'prop-run',
    baseline: async () => (await deps.oracleStore?.approvedInvariantsForStory(deps.workflowId, wp.storyId)) ?? null,
    buildPlan: (invariants) => buildInvariantAuthorPlan(wp, invariants),
  })
}

/** wp.risk가 minRisk 등급 이상인지(rank LOW<MEDIUM<HIGH). mutation 게이팅용. */
export function meetsMinRisk(wpRisk: WpRisk, minRisk: WpRisk): boolean {
  return RISK_RANK[wpRisk] >= RISK_RANK[minRisk]
}

/** P4 mutation θ_risk 채널(N8 강화): HIGH-risk WP의 스위트 강도를 자가단언 하니스로 검증.
 *  oracle 미소비 — 자체 guard 후 executeAuthoredTest 재사용(CPD0). score<θ면 하니스가 fail→fail(blocking). never-throw. */
function runMutationCheck(wp: WorkPackage, deps: VerifyDeps): Promise<VerificationVerdict> {
  if (deps.mutationEnabled !== true) { deps.recordOutcome?.('mutation', 'not_applicable'); return Promise.resolve({ ok: true }) }
  // 이 WP 는 mutation 대상 등급이 아니다 — 설계상 범위 밖이지 미증명이 아니다(S5.3a).
  // ⚠️ 이 비대상 판정은 `wp.risk` 만큼만 믿을 수 있는데, risk write-back 이 전 WP 를 균일하게
  //    덮어쓰는 한 등급은 분해 기본값(MEDIUM)에 머문다(결함 F2 · `S5.3b`). 그것이 고쳐져야
  //    "이 WP 는 mutation 대상이 아니다"가 실제 판단이 된다.
  if (!meetsMinRisk(wp.risk, deps.mutationMinRisk ?? 'HIGH')) { deps.recordOutcome?.('mutation', 'not_applicable'); return Promise.resolve({ ok: true }) }
  if (!deps.userContext?.workspaceRoot) {
    return Promise.resolve({ ok: false, reason: `${MUTATION_DIR}: workspaceRoot 미영속 — 검증 대상 경로 불명(fail-closed)` })
  }
  if (!deps.handlers['develop_code'] || !deps.handlers['run_tests']) {
    return Promise.resolve({ ok: false, reason: `${MUTATION_DIR}: develop_code/run_tests 핸들러 미주입` })
  }
  const plan = buildMutationHarnessPlan(wp, {
    theta: deps.mutationTheta ?? DEFAULT_MUTATION_THETA,
    maxMutants: deps.mutationMaxMutants ?? DEFAULT_MUTATION_MAX_MUTANTS,
  })
  return executeAuthoredTest(wp, deps, plan, MUTATION_DIR, 'mut-author', 'mut-run').then((v) => {
    if (v.ok) deps.recordOutcome?.('mutation', 'passed')
    return v
  })
}

/** P4 4d security 채널: develop_code 산출물에 SAST(security_audit)를 실행하고 결정론 findings(source∈{static,deps})
 *  중 severity≥floor가 있으면 fail(blocking). LLM findings 제외(N6). never-throw·fail-closed. oracle 미소비. */
async function runSecurityCheck(wp: WorkPackage, artifacts: string[], deps: VerifyDeps): Promise<VerificationVerdict> {
  if (deps.securityEnabled !== true) { deps.recordOutcome?.('security', 'not_applicable'); return { ok: true } }
  if (!deps.userContext?.workspaceRoot) {
    return { ok: false, reason: 'security: workspaceRoot 미영속 — 검증 대상 경로 불명(fail-closed)' }
  }
  if (!deps.handlers['security_audit']) return { ok: false, reason: 'security: security_audit 핸들러 미주입' }
  // security 메시지 스키마는 상대경로(`..` 없는)만 허용 — 위반 artifact는 메시지 거부를 유발하므로 선제 필터.
  // S5.1: 절대경로를 **드롭하지 않고 workspaceRoot 기준으로 상대화**한다. Security 의 상대경로
  // 규칙은 전선 형식이지 감사 범위가 아니다 — 드롭하면 Developer 가 낸 정상 산출물이 감사에서 빠진다.
  // 진짜로 감사할 수 없는 것(루트 밖·traversal)만 남고, 그것은 아래 judgeAuditable 이 불능으로 센다.
  const relArtifacts = artifacts
    .map((a) => toAuditPath(a, deps.userContext!.workspaceRoot))
    .filter((a): a is string => a !== null)
  const droppedArtifacts = artifacts.length - relArtifacts.length
  if (droppedArtifacts > 0) {
    console.warn(`[verify] security 채널 artifact ${droppedArtifacts}건이 workspaceRoot 밖·traversal — 감사 불능으로 판정`)
  }
  const ran = await execConformanceStep(
    deps, wp, { artifacts: relArtifacts, projectPath: deps.userContext.workspaceRoot, severity: 'low' },
    'security_audit', 'security',
  )
  if (!ran.ok) return ran
  const parsed = SecurityResultSchema.safeParse(ran.result)
  if (!parsed.success) return { ok: false, reason: 'security: 결과 파싱 실패(issues/severity/source 부재)' }
  // S5.1: "취약점 없음"과 "스캔 못 함"을 구분한다 — 감사 불능은 통과가 아니다(L2-2).
  // issues 검사보다 **먼저** 본다: 스캔을 못 했으면 issues 가 비어 있는 것에 의미가 없다.
  const auditable = judgeAuditable(parsed.data.auditable, { droppedArtifacts, sentArtifacts: relArtifacts.length })
  if (!auditable.auditable) {
    return { ok: false, reason: `security: 감사 불능 — ${auditable.reason}`.slice(0, REASON_MAX) }
  }
  const floor = deps.securityMinSeverity ?? DEFAULT_SECURITY_MIN_SEVERITY
  const blocking = parsed.data.issues.filter((i) => SECURITY_SOURCES.has(i.source) && meetsMinSeverity(i.severity, floor))
  if (blocking.length > 0) {
    const summary = blocking.slice(0, 3).map((i) => `${i.severity}:${i.source}`).join(', ')
    return { ok: false, reason: `security: 결정론 SAST ${blocking.length}건 차단(${summary})`.slice(0, REASON_MAX) }
  }
  deps.recordOutcome?.('security', 'passed')
  return { ok: true }
}

/** 파생 체크(build_project·run_tests) 순차 실 재실행(fail-fast). workspaceRoot 가드 통과 후 호출. */
async function runDerivedChecks(
  checks: string[], wp: WorkPackage, deps: VerifyDeps, checkSession: string,
): Promise<VerificationVerdict> {
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
  return { ok: true }
}

/** P4 채널 hard-AND(conformance→impact→property→mutation→security). 첫 non-ok에서 단락. 데이터 주도. */
async function runChannelChecks(wp: WorkPackage, deps: VerifyDeps, artifacts: string[]): Promise<VerificationVerdict> {
  const channels: Array<(w: WorkPackage, d: VerifyDeps) => Promise<VerificationVerdict>> = [
    runConformanceCheck, runImpactCheck, runPropertyCheck, runMutationCheck,
    (w, d) => runSecurityCheck(w, artifacts, d),
  ]
  for (const runChannel of channels) {
    const verdict = await runChannel(wp, deps)
    if (!verdict.ok) return verdict
  }
  return { ok: true }
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
  if (tool === 'run_tests' || tool === 'build_project') deps.recordOutcome?.('tc', 'passed')
  // S5.2a/S5.2b: security_audit·design_ui WP 는 자기 결과가 증거다. 판정을 통과한 뒤에만 기록한다 —
  // 기록이 없으면 릴리스 게이트가 `unverifiable` 로 보고 워크플로를 영구 차단한다.
  if (tool === 'security_audit') deps.recordOutcome?.('security', 'passed')
  if (tool === 'design_ui') deps.recordOutcome?.('design', 'passed')
  const checks = planVerificationChecks(tool)
  if (checks.length === 0) return { ok: true }
  // 파생 체크는 검증 대상 워크스페이스 경로가 명시돼야만 의미가 있다 — 부재 시 '.'로 돌리면 에이전트
  // cwd⊂WORKSPACE_ROOT 배포에서 엉뚱한 프로젝트(에이전트 자신)를 빌드·테스트해 false PASS가 된다.
  if (!deps.userContext?.workspaceRoot) {
    return { ok: false, reason: 'workspaceRoot 미영속 — 검증 대상 경로 불명(fail-closed)' }
  }
  const derived = await runDerivedChecks(checks, wp, deps, verifySessionId(deps.workflowId, wp.id, deps.attempt))
  if (!derived.ok) return derived
  if (tool === 'develop_code') {
    deps.recordOutcome?.('tc', 'passed')
    return runChannelChecks(wp, deps, extractArtifacts(result))
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
