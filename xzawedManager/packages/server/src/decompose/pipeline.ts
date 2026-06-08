import { coverageMatrix } from '@xzawed/agent-streams'
import type { CoverageMatrix, WorkPackage } from '@xzawed/agent-streams'
import { toWorkPackages, type LlmWorkPackage } from './map.js'
import { identifyEpics } from './stages/epics.js'
import { sliceVertical } from './stages/slice.js'
import { deriveDeliverables } from './stages/deliverables.js'
import { assignRoles } from './stages/roles.js'
import type { StageDeps } from './stages/run-stage.js'

export interface DecomposeResult {
  workPackages: WorkPackage[]
  coverage: CoverageMatrix
}

/** intent 한 줄을 단일 WP로(전체 붕괴 시 최종 안전망). */
export function fallbackWorkPackages(intent: string): WorkPackage[] {
  const wp: LlmWorkPackage = {
    ref: 'wp-1',
    storyId: 'story-1',
    owningRole: 'developer',
    acceptanceCriteria: [intent],
    dependsOn: [],
  }
  return toWorkPackages([wp])
}

/**
 * §6 P1·P2·P3·P5 다단계 분해. 각 단계는 내부 degrade하므로 throw 없음.
 * coverageMatrix(P2-1)는 보고 전용(수선은 P2-3b). WP는 flat(간선 없음, P6 후속).
 */
export async function runDecomposition(intent: string, deps: StageDeps): Promise<DecomposeResult> {
  const epics = await identifyEpics(intent, deps)
  const stories = await sliceVertical(epics, intent, deps)
  const deliverables = await deriveDeliverables(intent, deps)
  // coverage는 stories의 deliverable claim과 독립 인벤토리만 사용 — roles와 무관(순서 변경 무방).
  const coverage = coverageMatrix(
    stories.map((s) => ({ storyId: s.storyId, deliverableIds: s.deliverableIds })),
    deliverables,
  )
  const roles = await assignRoles(stories, deps)

  const llmWps: LlmWorkPackage[] = []
  for (const s of stories) {
    for (const role of roles.get(s.storyId) ?? ['developer']) {
      llmWps.push({
        ref: `${s.storyId}:${role}`,
        storyId: s.storyId,
        owningRole: role,
        acceptanceCriteria: s.acceptanceCriteria,
        dependsOn: [],
      })
    }
  }
  let workPackages = toWorkPackages(llmWps)
  if (workPackages.length === 0) workPackages = fallbackWorkPackages(intent)
  return { workPackages, coverage }
}
