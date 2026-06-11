import { z } from 'zod'

/**
 * Work Package 계약 — senario 사양 §5/§18-2의 작업 단위(PM이 분해).
 * 의존 그래프·oracle 참조·결함 귀속을 담아 Task Manager가 ready 노드만 디스패치하는 토대가 된다.
 *
 * ⚠️ 이 단계(P0 토대)는 **스키마 정의·테스트만**. 소비(분해 파이프라인·상태머신·디스패치)는 후속 Phase.
 * - `owningRole`: WP0 #3(5 vs 9 에이전트 토폴로지) 미해결로 현재 **자유 string**. 결정 후 enum 제약.
 * - `status`: P1 WP 상태머신(8+2 상태)으로 확장 예정. 지금은 최소 집합.
 */
/** §7 결함 귀속 카운터 — 계약 사슬 3계층(구현/Task/기획) 고정 형태. P4c 진동 차단(N5) 입력. */
export const AttributionCountersSchema = z
  .object({
    impl: z.number().int().nonnegative().default(0),
    task: z.number().int().nonnegative().default(0),
    plan: z.number().int().nonnegative().default(0),
  })
  // z.object는 미지 키를 strip — 레거시 자유형 record({})·임의 키도 고정 3필드로 정규화(backward-compat).
  .default({ impl: 0, task: 0, plan: 0 })

/** §7 WP 리스크 등급 — Wiki Agent 리스크 분류(P2 잔여)가 채움. θ_risk 게이트·모델 라우팅 입력. */
export const WpRiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])
export type WpRisk = z.infer<typeof WpRiskSchema>

export const WorkPackageSchema = z.object({
  /** content-hash 기반 안정 ID(동일 입력 → 동일 ID). */
  id: z.string().min(1),
  storyId: z.string().min(1),
  /** §7: 상위 epic 참조. 분해 생산자가 채우기 전엔 null(additive·backward-compat). */
  epicId: z.string().min(1).nullable().default(null),
  /** ⚠️ WP0 #3 결정 후 enum 제약. 현재는 자유 string. */
  owningRole: z.string().min(1),
  /** §7: 선행 산출물/스키마/계약 참조. */
  inputs: z.array(z.string()).default([]),
  /** §7: 산출물 + 형식 계약. */
  outputs: z.array(z.string()).default([]),
  /** P3 Oracle에서 채움(시나리오·골든 참조). 미정 시 null. */
  oracleRef: z.string().min(1).nullable(),
  acceptanceCriteria: z.array(z.string()).default([]),
  /** 선행 의존 Work Package id 목록. */
  dependencies: z.array(z.string()).default([]),
  /**
   * §7 리스크 등급. Wiki Agent 리스크 분류기(P2 잔여)가 채우기 전 기본 MEDIUM(중립·보수적).
   * id 정체성에 미포함(content-hash 제외) — 재분류가 id를 바꾸지 않는다(N4 안정).
   */
  risk: WpRiskSchema.default('MEDIUM'),
  /** §7 결함 국소화 귀속 카운터(고정 {impl,task,plan}). P4c 진동 차단(N5) 입력. */
  attributionCounters: AttributionCountersSchema,
  /** 최소 상태 집합. P1에서 정식 상태머신으로 확장. */
  status: z.enum(['draft', 'ready', 'in_progress', 'blocked', 'done']).default('draft'),
})

export type WorkPackage = z.infer<typeof WorkPackageSchema>
