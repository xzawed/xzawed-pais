import { coverageMatrix } from '@xzawed/agent-streams'
import type { CoverageMatrix, WorkPackage } from '@xzawed/agent-streams'
import { toWorkPackages, type LlmWorkPackage } from './map.js'
import { identifyEpics } from './stages/epics.js'
import { sliceVertical, type Story } from './stages/slice.js'
import { deriveDeliverables } from './stages/deliverables.js'
import { repairStories } from './stages/repair.js'
import { assignRoles } from './stages/roles.js'
import { singleRoleStoryIds } from './lint.js'
import type { StageDeps } from './stages/run-stage.js'

/** P4 repair 루프 최대 반복(기본). config MANAGER_DECOMPOSE_REPAIR_MAX로 오버라이드. */
export const DEFAULT_REPAIR_MAX = 2

export type DecomposeResult =
  | { status: 'ok'; workPackages: WorkPackage[]; coverage: CoverageMatrix; singleRoleStoryIds: string[] }
  | { status: 'inconsistent'; coverage: CoverageMatrix; reason: 'coverage' }

/** intent 한 줄을 단일 WP로(producer 기술-throw 경로 최종 안전망). */
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

/** §6 P4 100% 규칙 수렴 판정(순수): 갭·중복 모두 없음. */
function isConverged(c: CoverageMatrix): boolean {
  return c.gaps.length === 0 && c.overlaps.length === 0
}

/**
 * §6 P1·P2·P3·P4·P5 다단계 분해 + 자가수선.
 * repair 루프: coverageMatrix(순수)가 갭/중복 보고 → repairStories(LLM) → 재검증, K회까지. 수렴 시 진행,
 * 소진 시 inconsistent(reason 'coverage'). LLM은 의미 단계(epics/slice/deliverables/repair/roles)에만.
 * coverage·린트는 보고용. WP는 flat(간선 없음, P6 후속).
 */
export async function runDecomposition(
  intent: string,
  deps: StageDeps,
  repairMax: number = DEFAULT_REPAIR_MAX,
): Promise<DecomposeResult> {
  const epics = await identifyEpics(intent, deps)
  let stories = await sliceVertical(epics, intent, deps)
  const deliverables = await deriveDeliverables(intent, deps)
  const computeCoverage = (ss: Story[]): CoverageMatrix =>
    coverageMatrix(ss.map((s) => ({ storyId: s.storyId, deliverableIds: s.deliverableIds })), deliverables)

  let coverage = computeCoverage(stories)
  for (let iter = 0; iter < repairMax && !isConverged(coverage); iter++) {
    stories = await repairStories(stories, deliverables, coverage, deps)
    coverage = computeCoverage(stories)
  }
  if (!isConverged(coverage)) {
    return { status: 'inconsistent', coverage, reason: 'coverage' }
  }

  const roles = await assignRoles(stories, deps)
  const lint = singleRoleStoryIds(roles)

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
  return { status: 'ok', workPackages, coverage, singleRoleStoryIds: lint }
}
