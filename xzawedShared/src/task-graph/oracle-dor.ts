import type { WorkPackage } from '../types/work-package.js'

/** approved 오라클의 DoR 판정용 최소 뷰(repo가 산출). story 바인딩 + human_approved 시나리오로 덮인 AC 집합. */
export interface ApprovedOracleView {
  storyId: string
  /** ≥1 human_approved 시나리오가 덮는 acceptance_criterion 문자열 집합(ORACLE_SCHEMA §8). */
  coveredCriteria: Set<string>
}

/**
 * §8 DoR satisfied-set(순수·결정론·I/O 0): WP가 satisfied = storyId 바인딩 approved 오라클 존재 AND
 * wp.acceptanceCriteria 전부가 그 오라클 coveredCriteria에 포함. 빈 AC는 오라클 존재 시 vacuously true.
 * story당 approved 오라클은 1개 불변식(승인이 이전 버전 supersede); 다중이면 마지막 우선.
 */
export function oracleSatisfiedSet(workPackages: WorkPackage[], approvedOracles: ApprovedOracleView[]): Set<string> {
  const byStory = new Map<string, ApprovedOracleView>()
  for (const o of approvedOracles) byStory.set(o.storyId, o)
  const satisfied = new Set<string>()
  for (const wp of workPackages) {
    const oracle = byStory.get(wp.storyId)
    if (!oracle) continue
    if (wp.acceptanceCriteria.every((ac) => oracle.coveredCriteria.has(ac))) satisfied.add(wp.id)
  }
  return satisfied
}
