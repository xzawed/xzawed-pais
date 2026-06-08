import { contentHashId, WorkPackageSchema } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'

/** LLM이 emit하는 WP 초안(임시 ref·content-hash 전). */
export interface LlmWorkPackage {
  ref: string // 로컬 임시 id(의존 상호참조용, 최종 id 아님)
  storyId: string
  owningRole: string
  acceptanceCriteria: string[]
  dependsOn: string[] // 다른 WP의 ref 목록
}

/**
 * LLM 초안 → 디스패치 가능 WorkPackage[]. content-hash id 부여 후 dependsOn(ref)을 id로 리맵.
 * 미지 ref·자기참조는 드롭(dangling 방지). oracleRef=null(P3)·status='draft'. 중복 ref는 첫 항목만.
 * 충돌(동일 hash)·사이클은 막지 않음 — 소비자(P1d-2 buildTaskGraph/detectCycle)가 inconsistent 에스컬레이션.
 */
export function toWorkPackages(llmWps: LlmWorkPackage[]): WorkPackage[] {
  const refToId = new Map<string, string>()
  const order: LlmWorkPackage[] = []
  for (const w of llmWps) {
    if (refToId.has(w.ref)) continue // 중복 ref: 첫 항목만
    refToId.set(
      w.ref,
      contentHashId({ storyId: w.storyId, owningRole: w.owningRole, acceptanceCriteria: w.acceptanceCriteria }),
    )
    order.push(w)
  }
  return order.map((w) => {
    const id = refToId.get(w.ref)!
    const dependencies = w.dependsOn
      .filter((r) => r !== w.ref) // 자기참조(같은 ref) 드롭
      .flatMap((r) => { const depId = refToId.get(r); return depId ? [depId] : [] }) // 미지 ref 드롭
    return WorkPackageSchema.parse({
      id,
      storyId: w.storyId,
      owningRole: w.owningRole,
      oracleRef: null,
      acceptanceCriteria: w.acceptanceCriteria,
      dependencies,
      attributionCounters: {},
      status: 'draft',
    })
  })
}
