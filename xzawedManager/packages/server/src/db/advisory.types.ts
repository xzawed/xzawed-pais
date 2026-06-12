import { z } from 'zod'

/**
 * P4 advisory(optimization 렌즈·spec §9) 발견 — 영속·조회 단일출처. severity/sourceLens는 const로
 * 고정(N3 타입 수준 표식: advisory는 절대 차단 채널이 아니다). 진실원천은 manager_events(wp.advisory.found).
 */
export const AdvisoryFindingSchema = z.object({
  rank: z.number().int().min(1), // 순위(1=최우선) — §9 "제안 목록(순위)"
  title: z.string().min(1),
  rationale: z.string().min(1), // 비용·효과 근거
  severity: z.literal('advisory'),
  sourceLens: z.literal('optimization'),
})
export type AdvisoryFinding = z.infer<typeof AdvisoryFindingSchema>

/** LLM 출력 파싱 전용 — LLM은 title/rationale만 채우고 rank/severity/sourceLens는 코드가 합성한다.
 *  배열 루트 응답 미지원(run-stage extractJson)이라 객체 래핑 {findings:[...]}으로 받는다. */
export const LlmAdvisoryFindingSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().min(1),
})
export const AdvisoryFindingsResultSchema = z.object({
  findings: z.array(LlmAdvisoryFindingSchema).default([]),
})
export type AdvisoryFindingsResult = z.infer<typeof AdvisoryFindingsResultSchema>

export const ADVISORY_FOUND_EVENT = 'wp.advisory.found'
/** 도메인별 :main 스트림 패턴(risk/oracle/decision)과 정합. 현재 소비자 없음(투영 테이블이 sink). */
export const ADVISORY_STREAM = 'manager:advisory:main'
/** advisory 생산은 시스템 행동(사람 아님). */
export const ADVISORY_ACTOR = 'advisory-lens'
/** payload 폭주 방어(절단). */
export const MAX_ADVISORY_FINDINGS = 8
