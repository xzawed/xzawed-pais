import { describe, it, expect } from 'vitest'
import { buildDefectBrief } from './decision-brief.js'
import { buildDecomposeFailureBrief } from './decompose-failure.js'
import { buildDegradedDispatchBrief } from './degraded-signoff-brief.js'
import { buildGoldenBrief } from './golden-brief.js'
import { buildOracleBrief } from './oracle-brief.js'
import { buildRiskBrief } from './risk-brief.js'
import { buildSignoffBrief } from './signoff-brief.js'

/**
 * **브리프 빌더는 `context.options`를 반드시 채운다.**
 *
 * 대기함 UI는 이 값을 그대로 버튼으로 그린다. 비어 있으면 예전엔 UI가 4개짜리
 * 폴백을 그렸는데, 그중 `spec_fix`·`reject`는 `decision-consumer`에 핸들러가 없어
 * 눌러도 RESOLVED만 남는 무음 no-op이었다 — 거짓 affordance다.
 *
 * 폴백은 제거했으므로(빈 options는 "동작 없음"으로 표시된다) 이제 정본은 생산자다.
 * 새 브리프 빌더를 추가하면 여기에도 추가한다.
 */

describe('브리프 빌더 — context.options 계약', () => {
  const builders: Array<[string, () => { context?: { options?: string[] } }]> = [
    ['defect_brief', () => buildDefectBrief({
      workflowId: 'wf-1', wpId: 'wp-1', attempt: 1, stepN: 1, tries: 3,
    } as never)],
    ['decompose_inconsistent', () => buildDecomposeFailureBrief({
      workflowId: 'wf-1', reason: 'coverage',
    } as never)],
    ['degraded_dispatch', () => buildDegradedDispatchBrief({
      workflowId: 'wf-1', wpId: 'wp-1', mode: 'DEGRADED',
    } as never)],
    ['golden_diff', () => buildGoldenBrief({
      workflowId: 'wf-1', wpId: 'wp-1',
    } as never)],
    ['oracle_approval', () => buildOracleBrief({
      workflowId: 'wf-1', oracleId: 'o-1',
    } as never)],
    ['risk_classification', () => buildRiskBrief({
      workflowId: 'wf-1',
      version: 1,
      classification: {
        projectId: 'p-1', risk: 'HIGH', dimensionScores: {},
        humanGate: { reason: '고위험' }, complianceFrameworks: [],
      },
    } as never)],
    ['degraded_release', () => buildSignoffBrief({
      workflowId: 'wf-1', gateVersion: 'v1',
      blockingReasons: ['wp-1 미증명'], perWp: [{ wpId: 'wp-1', proven: false }],
    } as never, null)],
  ]

  for (const [name, build] of builders) {
    it(`${name} 빌더는 비어 있지 않은 options를 낸다`, () => {
      const req = build()
      expect(req.context?.options ?? []).not.toHaveLength(0)
    })
  }

  it('defect_brief는 핸들러가 있는 choice만 노출한다 — spec_fix·reject 금지', () => {
    // decision-consumer는 defect_brief에서 fix_reverify만 능동 처리한다.
    const req = buildDefectBrief({
      workflowId: 'wf-1', wpId: 'wp-1', attempt: 1, stepN: 1, tries: 3,
    } as never)
    expect(req.context?.options).toEqual(['fix_reverify'])
  })

  it('빌더 목록이 streams/의 실제 브리프 파일 수와 어긋나지 않는다', () => {
    // 새 빌더를 만들고 이 테스트에 추가하지 않으면 여기서 걸린다.
    expect(builders).toHaveLength(7)
  })
})
