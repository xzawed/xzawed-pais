import { describe, it, test, expect } from 'vitest'
import type { WorkPackage } from '@xzawed/agent-streams'
import type { OracleScenario, OracleGolden } from '../db/oracle.types.js'
import {
  CONFORMANCE_DIR, IMPACT_DIR, buildConformanceAuthorPlan, selectConformanceTestFiles,
  selectAuthoredTestFiles, buildGoldenDiffAuthorPlan,
} from './conformance.js'

const wp = { id: 'wp-7', storyId: 'story-1', owningRole: 'developer', acceptanceCriteria: ['AC-1'], oracleRef: null, dependsOn: [] } as unknown as WorkPackage
const scenarios: OracleScenario[] = [
  { id: 's1', title: '유효 토큰만 허용', given: ['발급된 토큰'], when: '재설정 요청', thenSteps: ['성공'], status: 'human_approved' },
]

describe('buildConformanceAuthorPlan', () => {
  it('includes every approved scenario and the no-modify instruction and the convention path', () => {
    const plan = buildConformanceAuthorPlan(wp, scenarios)
    expect(plan).toContain('s1')
    expect(plan).toContain('유효 토큰만 허용')
    expect(plan).toContain('발급된 토큰')
    expect(plan).toContain('재설정 요청')
    expect(plan).toContain('성공')
    expect(plan).toContain(`${CONFORMANCE_DIR}/wp-7`)
    expect(plan).toMatch(/구현 파일을 수정하지|do not modify/i)
  })

  it('clamps to 4000 chars', () => {
    const many: OracleScenario[] = Array.from({ length: 300 }, (_, i) => ({
      id: `s${i}`, title: 'x'.repeat(50), given: ['g'.repeat(50)], when: 'w', thenSteps: ['t'], status: 'human_approved',
    }))
    expect(buildConformanceAuthorPlan(wp, many).length).toBeLessThanOrEqual(4000)
  })
})

describe('selectConformanceTestFiles', () => {
  it('keeps only artifacts under the conformance dir for this wp (normalizing separators)', () => {
    const artifacts = [
      '.xzawed/conformance/wp-7.test.ts',
      '.xzawed\\conformance\\wp-7.spec.ts',
      'src/impl.ts',
      '.xzawed/conformance/wp-OTHER.test.ts',
    ]
    expect(selectConformanceTestFiles(artifacts, 'wp-7')).toEqual([
      '.xzawed/conformance/wp-7.test.ts',
      '.xzawed\\conformance\\wp-7.spec.ts',
    ])
  })

  it('returns empty when no conformance artifact present', () => {
    expect(selectConformanceTestFiles(['src/impl.ts'], 'wp-7')).toEqual([])
  })

  it('excludes an adjacent wpId that shares a prefix (wp-7 vs wp-70)', () => {
    const artifacts = ['.xzawed/conformance/wp-7.test.ts', '.xzawed/conformance/wp-70.test.ts']
    expect(selectConformanceTestFiles(artifacts, 'wp-7')).toEqual(['.xzawed/conformance/wp-7.test.ts'])
  })

  // 설계 §4·§8: 테스트 확장자 필터 — 비테스트 산출물은 컨벤션 경로 아래여도 제외해야 fail-closed(테스트 미작성)
  // 가드가 무력화되지 않는다(decision #8). .md/.txt/.json 같은 비실행 파일을 testFiles로 넘기면 0-테스트 통과(false-pass)가 된다.
  it('excludes non-test artifacts under the conformance dir (.md/.txt/.json) — fail-closed guard intact', () => {
    const artifacts = [
      '.xzawed/conformance/wp-7.md',
      '.xzawed/conformance/wp-7.txt',
      '.xzawed/conformance/wp-7.fixture.json',
    ]
    expect(selectConformanceTestFiles(artifacts, 'wp-7')).toEqual([])
  })

  it('keeps recognized test extensions including python (.test.ts/.spec.tsx/.py)', () => {
    const artifacts = [
      '.xzawed/conformance/wp-7.test.ts',
      '.xzawed/conformance/wp-7.spec.tsx',
      '.xzawed/conformance/wp-7.py',
    ]
    expect(selectConformanceTestFiles(artifacts, 'wp-7')).toEqual(artifacts)
  })

  it('accepts a leading ./ on the convention path', () => {
    expect(selectConformanceTestFiles(['./.xzawed/conformance/wp-7.test.ts'], 'wp-7')).toEqual(['./.xzawed/conformance/wp-7.test.ts'])
  })

  // 보안(좌측 앵커): 컨벤션 경로가 워크스페이스 루트가 아닌 곳(node_modules 등)에 박혀 있으면 author가
  // 임의의 워크스페이스 내 파일을 conf-run 대상으로 오지정할 수 있다 — prefix 좌측 앵커로 차단.
  it('excludes a conformance-dir substring embedded deeper in the path (not left-anchored)', () => {
    const artifacts = ['node_modules/x/.xzawed/conformance/wp-7.test.ts', 'vendor/copy/.xzawed/conformance/wp-7.spec.ts']
    expect(selectConformanceTestFiles(artifacts, 'wp-7')).toEqual([])
  })
})

describe('selectAuthoredTestFiles (일반화)', () => {
  test('dir 파라미터로 좌측 앵커 — impact 디렉토리 테스트만 선별(인접 wpId·비테스트·conformance 디렉토리 제외)', () => {
    const arts = [
      `${IMPACT_DIR}/wp-1.test.ts`, `${IMPACT_DIR}/wp-10.test.ts`,
      `${IMPACT_DIR}/wp-1.md`, `${CONFORMANCE_DIR}/wp-1.test.ts`,
    ]
    expect(selectAuthoredTestFiles(arts, IMPACT_DIR, 'wp-1')).toEqual([`${IMPACT_DIR}/wp-1.test.ts`])
  })

  test('selectConformanceTestFiles는 selectAuthoredTestFiles(CONFORMANCE_DIR) 위임(동작 보존)', () => {
    const arts = [`${CONFORMANCE_DIR}/wp-1.test.ts`, `${IMPACT_DIR}/wp-1.test.ts`]
    expect(selectConformanceTestFiles(arts, 'wp-1')).toEqual([`${CONFORMANCE_DIR}/wp-1.test.ts`])
  })
})

describe('buildGoldenDiffAuthorPlan', () => {
  const golden: OracleGolden[] = [
    { id: 'g1', inputFixture: 'IN-FIX', normalizedOutput: 'OUT-EXP', normalizers: ['strip ts'], frozenAt: '', frozenBy: 'po', fromDecision: null, version: 1 },
  ]

  test('golden별 inputFixture·normalizedOutput·normalizers를 담고 IMPACT_DIR 경로·구현 수정 금지·4000 클램프', () => {
    const plan = buildGoldenDiffAuthorPlan(wp, golden)
    expect(plan).toContain(`${IMPACT_DIR}/wp-7`)
    expect(plan).toContain('IN-FIX')
    expect(plan).toContain('OUT-EXP')
    expect(plan).toContain('strip ts')
    expect(plan).toContain('do not modify')
    expect(plan.length).toBeLessThanOrEqual(4000)
  })
})
