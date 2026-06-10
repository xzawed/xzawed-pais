import type { WorkPackage } from '@xzawed/agent-streams'
import type { OracleScenario } from '../db/oracle.types.js'

/** conformance 테스트 작성 컨벤션 디렉토리(워크스페이스 상대). author가 여기에 파일을 쓰고 Tester가 실행. */
export const CONFORMANCE_DIR = '.xzawed/conformance'

/** author develop_code 호출이 작성할 파일 경로 stem(확장자는 프로젝트 프레임워크에 맞춰 author가 선택). */
export const conformanceStem = (wpId: string): string => `${CONFORMANCE_DIR}/${wpId}`

/** verify.ts가 deps로 받는 최소 오라클 조회 포트(OracleRepo가 구조적으로 만족). */
export interface ConformanceOracleStore {
  approvedOracleForStory(
    workflowId: string, storyId: string,
  ): Promise<{ scenarios: OracleScenario[]; coverage: Record<string, string[]> } | null>
}

/** 사람 승인 GWT 시나리오를 conformance 테스트로 작성하라는 develop_code plan. 4000자 클램프(planner/developer 정합).
 *  호출자는 human_approved 시나리오만 전달해야 한다(이 함수는 받은 것을 그대로 렌더). */
export function buildConformanceAuthorPlan(wp: WorkPackage, scenarios: OracleScenario[]): string {
  const blocks = scenarios.map((s) => {
    const given = s.given.length ? s.given.join('; ') : '(none)'
    const thenSteps = s.thenSteps.length ? s.thenSteps.join('; ') : '(none)'
    return `Scenario ${s.id} — ${s.title}\n  Given: ${given}\n  When: ${s.when}\n  Then: ${thenSteps}`
  }).join('\n\n')
  const plan = [
    `Author an executable conformance test for story ${wp.storyId}, work package ${wp.id}.`,
    `Write the test file to \`${conformanceStem(wp.id)}\` choosing the extension that matches this project's test framework (e.g. .test.ts / .spec.ts / _test.py).`,
    `구현 파일을 수정하지 말라(do not modify any implementation file) — conformance 테스트 파일만 작성하라.`,
    `The test MUST assert ONLY the following human-approved behaviors against the existing implementation. Each scenario is at least one test case using the project's existing test framework:`,
    ``,
    blocks,
  ].join('\n')
  return plan.slice(0, 4000)
}

/** develop_code author 결과 artifacts 중 conformance 테스트 파일만 선별(구분자 정규화·`<wpId>.` 점-경계 앵커로
 *  인접 wpId(예: wp-7 vs wp-70) false-positive 차단). 파일은 `<CONFORMANCE_DIR>/<wpId>.<ext>` 컨벤션. */
export function selectConformanceTestFiles(artifacts: string[], wpId: string): string[] {
  const needle = `${CONFORMANCE_DIR}/${wpId}.`
  return artifacts.filter((a) => a.replace(/\\/g, '/').includes(needle))
}
