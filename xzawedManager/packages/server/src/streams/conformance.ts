import type { WorkPackage } from '@xzawed/agent-streams'
import type { OracleScenario, OracleGolden, OracleInvariant } from '../db/oracle.types.js'

/** conformance 테스트 작성 컨벤션 디렉토리(워크스페이스 상대). author가 여기에 파일을 쓰고 Tester가 실행. */
export const CONFORMANCE_DIR = '.xzawed/conformance'

/** golden-differential 테스트 작성 컨벤션 디렉토리(conformance와 분리 — 테스트 파일 충돌 방지·P4 impact). */
export const IMPACT_DIR = '.xzawed/impact'

/** property(invariants) 테스트 작성 컨벤션 디렉토리(conformance/impact와 분리·P4 property 채널). */
export const PROPERTY_DIR = '.xzawed/property'

/** author develop_code 호출이 작성할 파일 경로 stem(확장자는 프로젝트 프레임워크에 맞춰 author가 선택).
 *  conformanceStem = conformance 채널, impactStem = golden-differential 채널, propertyStem = property(invariants) 채널. */
export const conformanceStem = (wpId: string): string => `${CONFORMANCE_DIR}/${wpId}`
export const impactStem = (wpId: string): string => `${IMPACT_DIR}/${wpId}`
export const propertyStem = (wpId: string): string => `${PROPERTY_DIR}/${wpId}`

/** verify.ts가 deps로 받는 최소 오라클 조회 포트(OracleRepo가 구조적으로 만족). */
export interface ConformanceOracleStore {
  approvedOracleForStory(
    workflowId: string, storyId: string,
  ): Promise<{ scenarios: OracleScenario[]; coverage: Record<string, string[]> } | null>
}

/** P4 impact: golden-differential 베이스라인 조회 포트(OracleRepo가 구조적으로 만족). */
export interface ImpactOracleStore {
  approvedGoldensForStory(workflowId: string, storyId: string): Promise<OracleGolden[] | null>
}

/** P4 property: 사람 승인 invariants 조회 포트(OracleRepo가 구조적으로 만족·human_approved만 반환). */
export interface InvariantOracleStore {
  approvedInvariantsForStory(workflowId: string, storyId: string): Promise<OracleInvariant[] | null>
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

/** 인식하는 실행 가능 테스트 파일 마커(설계 §4 목록: `.test.`·`.spec.`·`_test.`·`test_`·`.py`). 비테스트
 *  산출물(.md·.txt·.json·.fixture.json 등)을 제외해 "테스트 미작성=fail-closed"(decision #8) 가드가
 *  무력화되지 않게 한다 — 비실행 파일을 testFiles로 넘기면 0-테스트가 failed:0으로 통과(false-pass)된다. */
const TEST_FILE_RE = /\.test\.|\.spec\.|_test\.|(?:(?:^|\/)test_)|(?:\.py$)/i

/** develop_code author 결과 artifacts 중 conformance 테스트 파일만 선별. 두 불변식(설계 §4):
 *  ① **좌측 prefix 앵커** `<CONFORMANCE_DIR>/<wpId>.` — `<wpId>.` 점-경계로 인접 wpId(wp-7 vs wp-70) 차단 +
 *     워크스페이스 루트 고정으로 node_modules 등 깊은 경로에 박힌 동명 파일 오지정 차단(보안). 구분자 정규화·leading `./` 허용.
 *  ② **테스트 확장자 필터**(TEST_FILE_RE) — 컨벤션 경로 아래여도 비테스트 산출물은 제외(fail-closed 가드 유지).
 *  반환은 원본 artifact 문자열(정규화는 매칭에만 사용). */
export function selectAuthoredTestFiles(artifacts: string[], dir: string, wpId: string): string[] {
  const prefix = `${dir}/${wpId}.`
  return artifacts.filter((a) => {
    const norm = a.replaceAll('\\', '/').replace(/^\.\//, '')
    return norm.startsWith(prefix) && TEST_FILE_RE.test(norm)
  })
}

/** P4b-2 conformance 테스트 파일 선별 — 일반 헬퍼에 CONFORMANCE_DIR 위임(API·동작 보존). */
export function selectConformanceTestFiles(artifacts: string[], wpId: string): string[] {
  return selectAuthoredTestFiles(artifacts, CONFORMANCE_DIR, wpId)
}

/** 사람 사인오프 golden을 differential 테스트로 작성하라는 develop_code plan. impl을 inputFixture로 실행→
 *  normalizers 적용→normalizedOutput과 동등 단언. 구현 수정 금지·4000자 클램프(planner/developer 정합). */
export function buildGoldenDiffAuthorPlan(wp: WorkPackage, goldens: OracleGolden[]): string {
  const blocks = goldens.map((g) => {
    const norms = g.normalizers.length ? g.normalizers.join('; ') : '(none)'
    return `Golden ${g.id} (v${g.version})\n  Input fixture: ${g.inputFixture}\n  Normalizers: ${norms}\n  Expected normalized output: ${g.normalizedOutput}`
  }).join('\n\n')
  const plan = [
    `Author an executable golden-differential test for story ${wp.storyId}, work package ${wp.id}.`,
    `Write the test file to \`${impactStem(wp.id)}\` choosing the extension that matches this project's test framework (e.g. .test.ts / .spec.ts / _test.py).`,
    `구현 파일을 수정하지 말라(do not modify any implementation file) — golden-differential 테스트 파일만 작성하라.`,
    `For EACH golden below: run the existing implementation on the input fixture, apply the listed normalizers to the actual output, and assert it EQUALS the expected normalized output. Each golden is at least one test case using the project's existing test framework:`,
    ``,
    blocks,
  ].join('\n')
  return plan.slice(0, 4000)
}

/** 사람 승인 invariants를 boundary+명시 속성 단언 테스트로 작성하라는 develop_code plan(결정론·무작위 0).
 *  구현 수정 금지·4000자 클램프(planner/developer 정합). 호출자는 human_approved invariant만 전달. */
export function buildInvariantAuthorPlan(wp: WorkPackage, invariants: OracleInvariant[]): string {
  const blocks = invariants.map((inv) =>
    `Invariant ${inv.id} — ${inv.statement}\n  Domain: ${inv.domain}\n  Property: ${inv.property}`,
  ).join('\n\n')
  const plan = [
    `Author executable property tests for story ${wp.storyId}, work package ${wp.id}.`,
    `Write the test file to \`${propertyStem(wp.id)}\` choosing the extension that matches this project's test framework (e.g. .test.ts / .spec.ts / _test.py).`,
    `구현 파일을 수정하지 말라(do not modify any implementation file) — property 테스트 파일만 작성하라.`,
    `For EACH invariant below, write DETERMINISTIC test cases (no random fuzzing): (1) boundary-value cases at and around each threshold the property mentions (just-below, at, just-above — at least 3 points), and (2) representative-input cases asserting the property holds. Use the project's existing test framework. Each invariant is at least one test case:`,
    ``,
    blocks,
  ].join('\n')
  return plan.slice(0, 4000)
}
