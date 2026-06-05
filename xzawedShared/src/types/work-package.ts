import { z } from 'zod'

/**
 * Work Package 계약 — senario 사양 §5/§18-2의 작업 단위(PM이 분해).
 * 의존 그래프·oracle 참조·결함 귀속을 담아 Task Manager가 ready 노드만 디스패치하는 토대가 된다.
 *
 * ⚠️ 이 단계(P0 토대)는 **스키마 정의·테스트만**. 소비(분해 파이프라인·상태머신·디스패치)는 후속 Phase.
 * - `owningRole`: WP0 #3(5 vs 9 에이전트 토폴로지) 미해결로 현재 **자유 string**. 결정 후 enum 제약.
 * - `status`: P1 WP 상태머신(8+2 상태)으로 확장 예정. 지금은 최소 집합.
 */
export const WorkPackageSchema = z.object({
  /** content-hash 기반 안정 ID(동일 입력 → 동일 ID). */
  id: z.string().min(1),
  storyId: z.string().min(1),
  /** ⚠️ WP0 #3 결정 후 enum 제약. 현재는 자유 string. */
  owningRole: z.string().min(1),
  /** P3 Oracle에서 채움(시나리오·골든 참조). 미정 시 null. */
  oracleRef: z.string().min(1).nullable(),
  acceptanceCriteria: z.array(z.string()).default([]),
  /** 선행 의존 Work Package id 목록. */
  dependencies: z.array(z.string()).default([]),
  /** P4 결함 국소화 귀속 카운터(role/agent → count). */
  attributionCounters: z.record(z.number().int()).default({}),
  /** 최소 상태 집합. P1에서 정식 상태머신으로 확장. */
  status: z.enum(['draft', 'ready', 'in_progress', 'blocked', 'done']).default('draft'),
})

export type WorkPackage = z.infer<typeof WorkPackageSchema>
